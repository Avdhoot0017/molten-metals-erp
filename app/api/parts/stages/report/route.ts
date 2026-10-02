import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { parsePagination, buildPaginationMeta } from "@/lib/pagination";
import { stageColumns } from "@/lib/pieces";
import { Prisma } from "@prisma/client";

/**
 * The shop-floor table: one row per part, where its pieces are and what moved.
 *
 * Two different questions share the date filter, and each column answers one:
 *
 *   ON THE FLOOR  - balances as of the END of the "to" date. Rebuilt from the
 *                   piece ledger, so "what was at belt sander last Tuesday" has
 *                   an exact answer, not today's figure with a date on it.
 *   IN THE PERIOD - what moved between "from" and "to": castings that entered
 *                   the route, pieces that finished it, pieces melted.
 *
 * Dates are UTC day boundaries, the same convention the production list uses,
 * so a date typed on either page means the same span of time.
 */

/** "YYYY-MM-DD", or nothing. Anything else is ignored rather than guessed at. */
function dayBoundary(value: string | null, end: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canRead(session, "fettling") && !canRead(session, "production")) {
      return NextResponse.json(
        { error: "You do not have permission to view this data" },
        { status: 403 }
      );
    }

    const { searchParams } = request.nextUrl;
    const { page, pageSize, skip, take } = parsePagination(searchParams);
    const search = searchParams.get("search")?.trim();
    const from = dayBoundary(searchParams.get("from"), false);
    const to = dayBoundary(searchParams.get("to"), true);
    // Narrows to parts with pieces in a given state - "where is work stuck?"
    const holding = searchParams.get("holding")?.trim();

    if (from && to && from > to) {
      return NextResponse.json(
        { error: "The From date is after the To date" },
        { status: 400 }
      );
    }

    // Only parts that take part in piece tracking: a route, or pieces already
    // counted somewhere (a part with no route sends its castings to Ready).
    const where: Prisma.PartWhereInput = {
      isActive: true,
      OR: [{ routeSteps: { some: {} } }, { stages: { some: {} } }],
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { partCode: { contains: search, mode: "insensitive" as const } },
                  { name: { contains: search, mode: "insensitive" as const } },
                ],
              },
            ],
          }
        : {}),
    };

    const allParts = await prisma.part.findMany({
      where,
      orderBy: { partCode: "asc" },
      select: {
        id: true,
        partCode: true,
        name: true,
        alloyGrade: true,
        routeSteps: {
          orderBy: { sequence: "asc" },
          select: {
            id: true,
            sequence: true,
            activityType: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (allParts.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        totals: { inProcess: 0, inRework: 0, ready: 0, castIn: 0, finished: 0, melted: 0 },
        pagination: buildPaginationMeta(0, { page, pageSize }),
      });
    }

    const partIds = allParts.map((p) => p.id);

    /*
     * Balances at the end of the "to" date.
     *
     * Every movement writes the stage's new quantity to the log, so the latest
     * log row at or before a moment IS the balance at that moment - no replay,
     * no arithmetic to drift. With no "to" date, the live table answers.
     */
    const balances: Array<{ partId: string; stageKey: string; quantity: number }> = to
      ? (
          await prisma.$queryRaw<
            Array<{ partId: string; stageKey: string; newQty: number }>
          >(Prisma.sql`
            SELECT DISTINCT ON ("partId", "stageKey") "partId", "stageKey", "newQty"
            FROM "part_stage_logs"
            WHERE "partId" IN (${Prisma.join(partIds)})
              AND "createdAt" <= ${to}
            ORDER BY "partId", "stageKey", "createdAt" DESC, "id" DESC
          `)
        ).map((r) => ({ partId: r.partId, stageKey: r.stageKey, quantity: Number(r.newQty) }))
      : await prisma.partStage.findMany({
          where: { partId: { in: partIds } },
          select: { partId: true, stageKey: true, quantity: true },
        });

    // What moved in the period, from the same ledger
    const periodLogs = await prisma.partStageLog.groupBy({
      by: ["partId", "stageKey", "reference"],
      where: {
        partId: { in: partIds },
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      _sum: { quantity: true },
    });

    /*
     * Pieces melted, from the day's work itself.
     *
     * Melted pieces leave the flow without landing anywhere, so the stage log
     * cannot show them - it records where pieces are, and these are nowhere.
     * The fettling lines say it directly: rejected, less sent for repair.
     * Only lines in the piece flow count, so this reconciles with the cast and
     * finished columns rather than mixing in pre-routing history.
     */
    const meltedRows = await prisma.$queryRaw<
      Array<{ partId: string; melted: bigint | number | null }>
    >(Prisma.sql`
      SELECT i."partId",
             SUM(GREATEST(i."partsRejected" - i."reworkQty", 0)) AS melted
      FROM "fettling_activity_items" i
      JOIN "fettling_activities" a ON a."id" = i."activityId"
      WHERE i."partId" IN (${Prisma.join(partIds)})
        AND (i."routeStepId" IS NOT NULL OR i."reworkFromStepId" IS NOT NULL)
        ${from ? Prisma.sql`AND a."date" >= ${from}` : Prisma.empty}
        ${to ? Prisma.sql`AND a."date" <= ${to}` : Prisma.empty}
      GROUP BY i."partId"
    `);
    const meltedFor = new Map(meltedRows.map((r) => [r.partId, Number(r.melted ?? 0)]));

    /*
     * The repair loop, which the stage balances cannot show.
     *
     * A balance says where pieces are now; these say what happened to them.
     * "Sent for repair" and "saved at the bench" are the two figures a
     * supervisor actually asks about, and a piece that went round the loop is
     * invisible in a before/after count - it left a station and came back to it.
     */
    const repairRows = await prisma.$queryRaw<
      Array<{ partId: string; sent: bigint | number | null; saved: bigint | number | null }>
    >(Prisma.sql`
      SELECT i."partId",
             SUM(i."reworkQty") AS sent,
             SUM(CASE WHEN i."reworkFromStepId" IS NOT NULL
                      THEN GREATEST(i."partsCompleted" - i."partsRejected", 0)
                      ELSE 0 END) AS saved
      FROM "fettling_activity_items" i
      JOIN "fettling_activities" a ON a."id" = i."activityId"
      WHERE i."partId" IN (${Prisma.join(partIds)})
        ${from ? Prisma.sql`AND a."date" >= ${from}` : Prisma.empty}
        ${to ? Prisma.sql`AND a."date" <= ${to}` : Prisma.empty}
      GROUP BY i."partId"
    `);
    const repairFor = new Map(
      repairRows.map((r) => [
        r.partId,
        { sent: Number(r.sent ?? 0), saved: Number(r.saved ?? 0) },
      ])
    );

    const rows = allParts.map((part) => {
      const stepName = new Map(part.routeSteps.map((s) => [s.id, s.activityType.name]));

      let inProcess = 0;
      let inRework = 0;
      let ready = 0;
      // Per place, as of the same moment - what the flow view draws
      const stages: Array<{ stageKey: string; quantity: number }> = [];
      // The station holding the most - "where is this part stuck?"
      let bottleneck: { name: string; quantity: number } | null = null;

      for (const b of balances) {
        if (b.partId !== part.id || b.quantity === 0) continue;
        stages.push({ stageKey: b.stageKey, quantity: b.quantity });
        const { kind, routeStepId } = stageColumns(b.stageKey);
        if (kind === "READY") {
          ready += b.quantity;
          continue;
        }
        if (kind === "REWORK") inRework += b.quantity;
        else inProcess += b.quantity;

        const name = routeStepId ? stepName.get(routeStepId) : undefined;
        if (kind === "WAITING" && name && (!bottleneck || b.quantity > bottleneck.quantity)) {
          bottleneck = { name, quantity: b.quantity };
        }
      }

      let castIn = 0;
      let finished = 0;
      let counted = 0;
      for (const log of periodLogs) {
        if (log.partId !== part.id) continue;
        const qty = log._sum.quantity ?? 0;
        // Net of reversals, so a batch deleted in the period cancels itself
        if (log.reference === "PRODUCTION") castIn += qty;
        // A count is not work - kept apart so it never reads as output
        if (log.reference === "STOCKTAKE") counted += qty;
        else if (log.stageKey === "READY") finished += qty;
      }

      return {
        id: part.id,
        partCode: part.partCode,
        name: part.name,
        alloyGrade: part.alloyGrade,
        routeSteps: part.routeSteps,
        inProcess,
        inRework,
        ready,
        onFloor: inProcess + inRework,
        bottleneck,
        castIn,
        finished,
        melted: meltedFor.get(part.id) ?? 0,
        /** Pieces a bench turned down but sent for repair rather than the melt. */
        sentToRepair: repairFor.get(part.id)?.sent ?? 0,
        /** Pieces the repair bench saved and put back into the route. */
        repaired: repairFor.get(part.id)?.saved ?? 0,
        counted,
        stages,
      };
    });

    const filtered = rows.filter((r) => {
      if (holding === "process") return r.inProcess > 0;
      if (holding === "rework") return r.inRework > 0;
      if (holding === "ready") return r.ready > 0;
      return true;
    });

    // Totals across every matching part, not just the page on screen
    const totals = filtered.reduce(
      (acc, r) => ({
        inProcess: acc.inProcess + r.inProcess,
        inRework: acc.inRework + r.inRework,
        ready: acc.ready + r.ready,
        castIn: acc.castIn + r.castIn,
        finished: acc.finished + r.finished,
        melted: acc.melted + r.melted,
      }),
      { inProcess: 0, inRework: 0, ready: 0, castIn: 0, finished: 0, melted: 0 }
    );

    return NextResponse.json({
      success: true,
      data: filtered.slice(skip, skip + take),
      totals,
      pagination: buildPaginationMeta(filtered.length, { page, pageSize }),
    });
  } catch (error) {
    console.error("Error building shop-floor report:", error);
    return NextResponse.json(
      { error: "Failed to load the shop floor" },
      { status: 500 }
    );
  }
}
