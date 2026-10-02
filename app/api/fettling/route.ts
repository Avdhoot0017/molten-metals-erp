import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession, canRecordFettlingActivity } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import {
  parseDateOnly,
  canEditSheetForDate,
  SHEET_LOCKED_MESSAGE,
  toDateOnlyString,
  fettlingScrapMovements,
  scrapDelta,
} from "@/lib/fettling";
import { formatWeight } from "@/lib/units";
import { materialLabel } from "@/lib/ingot";
import {
  fettlingMoves,
  stageDelta,
  reverseMoves,
  applyStageMoves,
  describeStage,
  type RouteStepRef,
  type StageMoves,
} from "@/lib/pieces";
import type { AluminumType } from "@/types";
import { Prisma } from "@prisma/client";

/**
 * A movement the shop floor will not allow: more pieces worked than are
 * standing at the station, or scrap taken back that has already been melted.
 *
 * Thrown rather than returned because the checks run inside the transaction,
 * where returning early would commit the half of it already written. It also
 * carries its own message out to the operator, instead of being flattened into
 * a generic 500 the way these refusals used to be.
 */
export class MovementRefused extends Error {}

export interface NormalisedItem {
  partId: string;
  partsCompleted: number;
  partsRejected: number;
  /** Weighed scrap in grams, or null to use count x the part's weight. */
  rejectedWeight: number | null;
  /**
   * The station in this part's route that this work belongs to.
   *
   * Null only for a part with no route, whose pieces are not tracked through
   * the shop. Everything else is pinned to a step, which is what lets the
   * entry move pieces along instead of inventing them.
   */
  routeStepId: string | null;
  /** Of the rejects, how many went for repair rather than the melt. */
  reworkQty: number;
  /** Set when this line repairs rejects instead of working the route. */
  reworkFromStepId: string | null;
  /** Where repaired pieces rejoin the route. */
  returnStepId: string | null;
}

/**
 * Validates the part lines of a day's work and rolls them up.
 *
 * An employee handles several parts in a shift, so the figures are per part
 * and the day's totals are their sum - stored rather than recomputed on every
 * read, because the dashboard aggregates these across months.
 */
export async function normaliseItems(
  raw: unknown,
  /** The process this day's work was done on - decides which step each line is. */
  activityTypeId: string
): Promise<
  | {
      ok: true;
      items: NormalisedItem[];
      completed: number;
      rejected: number;
      /** Weight and alloy per part, for booking the rejected scrap. */
      parts: Map<string, { weightPerPiece: number; alloyGrade: string }>;
      /** Each part's ordered route, for moving pieces along it. */
      routes: Map<string, RouteStepRef[]>;
      partCodes: Map<string, string>;
    }
  | { ok: false; error: string }
> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Add at least one part" };
  }

  const items: NormalisedItem[] = [];
  const seen = new Set<string>();

  for (const line of raw) {
    if (!line?.partId) return { ok: false, error: "Every line needs a part" };
    if (seen.has(line.partId)) {
      return { ok: false, error: "The same part is listed more than once" };
    }
    seen.add(line.partId);

    const done = Number(line.partsCompleted);
    if (!Number.isInteger(done) || done < 0) {
      return { ok: false, error: "Parts done must be a whole number of 0 or more" };
    }

    // Blank means none were rejected - the common case, not an error
    const rejected =
      line.partsRejected === null ||
      line.partsRejected === undefined ||
      line.partsRejected === ""
        ? 0
        : Number(line.partsRejected);
    if (!Number.isInteger(rejected) || rejected < 0) {
      return { ok: false, error: "Rejected parts must be a whole number of 0 or more" };
    }
    if (rejected > done) {
      return { ok: false, error: "Rejected parts cannot exceed parts done" };
    }

    // Optional. Blank means nobody weighed them, so the count times the part's
    // weight stands - which is what every entry recorded so far relies on.
    const hasWeight =
      line.rejectedWeight !== null &&
      line.rejectedWeight !== undefined &&
      line.rejectedWeight !== "";
    const rejectedWeight = hasWeight ? Number(line.rejectedWeight) : null;
    if (rejectedWeight !== null && (!Number.isFinite(rejectedWeight) || rejectedWeight < 0)) {
      return { ok: false, error: "Rejected scrap weight must be a number of 0 or more" };
    }
    // A weight against no rejects would book scrap that nothing accounts for
    if (rejectedWeight !== null && rejectedWeight > 0 && rejected === 0) {
      return {
        ok: false,
        error: "A rejected scrap weight needs a rejected count to go with it",
      };
    }

    // Of the rejects, how many are worth saving. Blank means none - which is
    // what every entry recorded before rework existed meant.
    const rework =
      line.reworkQty === null || line.reworkQty === undefined || line.reworkQty === ""
        ? 0
        : Number(line.reworkQty);
    if (!Number.isInteger(rework) || rework < 0) {
      return { ok: false, error: "Pieces sent for rework must be a whole number of 0 or more" };
    }
    if (rework > rejected) {
      return {
        ok: false,
        error: "More pieces sent for rework than were rejected",
      };
    }

    /*
     * Pieces going to the melt have to be weighed.
     *
     * This weight is added to rejected-part stock, so it is a stock figure and
     * has to come off a scale. Count x the part's nominal weight was a
     * reasonable stand-in while it was only a report; a casting rejected as a
     * part-filled pour, or broken up before it reaches the bin, does not weigh
     * what the drawing says.
     */
    if (rejected - rework > 0 && rejectedWeight === null) {
      return {
        ok: false,
        error: `Weigh the ${rejected - rework} piece${rejected - rework === 1 ? "" : "s"} going to the melt - that weight is what goes into rejected-part stock`,
      };
    }

    items.push({
      partId: line.partId,
      partsCompleted: done,
      partsRejected: rejected,
      rejectedWeight,
      reworkQty: rework,
      // Filled in below, once the parts' routes have been read
      routeStepId: null,
      reworkFromStepId: null,
      returnStepId: null,
      // Carried through so the route resolution below can read them
      source: typeof line.source === "string" ? line.source : null,
      returnTo: typeof line.returnTo === "string" ? line.returnTo : null,
    } as NormalisedItem & { source: string | null; returnTo: string | null });
  }

  const known = await prisma.part.findMany({
    where: { id: { in: items.map((i) => i.partId) } },
    select: {
      id: true,
      partCode: true,
      weightPerPiece: true,
      alloyGrade: true,
      routeSteps: {
        orderBy: { sequence: "asc" },
        select: { id: true, sequence: true, activityTypeId: true },
      },
    },
  });
  if (known.length !== items.length) {
    return { ok: false, error: "Part not found" };
  }

  /*
   * Pin each line to the station in that part's route.
   *
   * This is what stops the double counting. Without a station, an entry is
   * just a number that gets added up; with one, it is "these pieces moved from
   * here to there", and the same ten pieces cannot be counted at two places.
   */
  const routes = new Map<string, RouteStepRef[]>();
  const partCodes = new Map<string, string>();
  for (const part of known) {
    routes.set(part.id, part.routeSteps);
    partCodes.set(part.id, part.partCode);
  }
  // Needed to name the offending station when a return step is refused
  const processNames = await processNamesFor(routes);

  for (const item of items) {
    const line = item as NormalisedItem & {
      source: string | null;
      returnTo: string | null;
    };
    const route = routes.get(item.partId) ?? [];
    const code = partCodes.get(item.partId) ?? "That part";

    // A part with no route is not tracked through the shop. Its work is still
    // recorded as labour; it simply moves no pieces.
    if (route.length === 0) continue;

    /*
     * Two kinds of work happen at a bench, and they draw from different queues.
     *
     * Route work takes pieces from this station's own queue. Rework takes them
     * from the reject queue of whichever station turned them down - a welder
     * works on "the ones leak testing failed", which may not be a step of the
     * route at all. The caller says which by naming the queue.
     */
    const isRework = line.source?.startsWith("REWORK:") ?? false;

    if (isRework) {
      const fromStepId = line.source!.slice("REWORK:".length);
      const rejectedAt = route.find((s) => s.id === fromStepId);
      if (!rejectedAt) {
        return {
          ok: false,
          error: `That rework queue does not belong to ${code}`,
        };
      }
      // A piece that failed rework is scrap. Sending it round the loop again
      // inside one entry would be a line reworking its own output.
      if (item.reworkQty > 0) {
        return {
          ok: false,
          error: "A piece that cannot be saved at rework goes to the melt, not back to rework",
        };
      }

      /*
       * Where the repaired pieces rejoin the route - any station on it.
       *
       * A weld can undo work that has to be done again, or leave a casting
       * ready for a later stage entirely, and only the person holding it knows
       * which. So the choice is theirs: any step of this part's route, with
       * the one that rejected them as the default.
       *
       * It has to be a step of THIS part's route, or the pieces would be put
       * somewhere that does not exist for them.
       */
      const returnStepId = line.returnTo || fromStepId;
      const returnStep = route.find((s) => s.id === returnStepId);
      if (!returnStep) {
        return { ok: false, error: `That return step does not belong to ${code}` };
      }

      item.reworkFromStepId = fromStepId;
      item.returnStepId = returnStepId;
      continue;
    }

    const step = route.find((s) => s.activityTypeId === activityTypeId);
    if (!step) {
      return {
        ok: false,
        error: `${code} does not go through this process. Add it to the part's route, or record this work against a part that does.`,
      };
    }
    item.routeStepId = step.id;
  }

  // `source` and `returnTo` were only ever how the caller named a queue. The
  // resolved step ids are what get stored, so the raw ones are dropped here -
  // passing them through would be handing Prisma columns that do not exist.
  const stored: NormalisedItem[] = items.map((i) => ({
    partId: i.partId,
    partsCompleted: i.partsCompleted,
    partsRejected: i.partsRejected,
    rejectedWeight: i.rejectedWeight,
    reworkQty: i.reworkQty,
    routeStepId: i.routeStepId,
    reworkFromStepId: i.reworkFromStepId,
    returnStepId: i.returnStepId,
  }));

  return {
    ok: true,
    items: stored,
    completed: items.reduce((sum, i) => sum + i.partsCompleted, 0),
    rejected: items.reduce((sum, i) => sum + i.partsRejected, 0),
    routes,
    partCodes,
    parts: new Map(
      known.map((p) => [
        p.id,
        { weightPerPiece: p.weightPerPiece, alloyGrade: p.alloyGrade },
      ])
    ),
  };
}

/** Process names for the steps in these routes, so refusals name the station. */
async function processNamesFor(
  routes: Map<string, RouteStepRef[]>
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const route of routes.values()) {
    for (const step of route) ids.add(step.activityTypeId);
  }
  if (ids.size === 0) return new Map();
  const types = await prisma.activityType.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true },
  });
  return new Map(types.map((t) => [t.id, t.name]));
}

/**
 * The piece movements an entry, as stored, is responsible for.
 *
 * Read back from the saved lines rather than recomputed from the request, so
 * an amendment is measured against what is actually on the floor.
 */
async function pieceMovementsFor(activityId: string): Promise<{
  moves: StageMoves;
  routes: Map<string, RouteStepRef[]>;
}> {
  const items = await prisma.fettlingActivityItem.findMany({
    where: { activityId },
    select: {
      partId: true,
      partsCompleted: true,
      partsRejected: true,
      routeStepId: true,
      reworkQty: true,
      reworkFromStepId: true,
      returnStepId: true,
      part: {
        select: {
          routeSteps: {
            orderBy: { sequence: "asc" },
            select: { id: true, sequence: true, activityTypeId: true },
          },
        },
      },
    },
  });

  const routes = new Map<string, RouteStepRef[]>();
  for (const item of items) routes.set(item.partId, item.part.routeSteps);

  return { moves: fettlingMoves(items, routes), routes };
}

/** The rejected-scrap movements an entry, as stored, is responsible for. */
async function movementsFor(activityId: string) {
  const items = await prisma.fettlingActivityItem.findMany({
    where: { activityId },
    select: {
      partsRejected: true,
      reworkQty: true,
      rejectedWeight: true,
      part: { select: { weightPerPiece: true, alloyGrade: true } },
    },
  });
  return fettlingScrapMovements(items);
}

/**
 * Moves stock by `deltas` and writes a log line for each.
 *
 * Refuses before writing anything if a line would go negative - scrap booked
 * in from fettling may since have been re-melted into a heat, so taking it
 * back out is not always possible.
 */
async function applyScrapDeltas(
  tx: Prisma.TransactionClient,
  deltas: Map<AluminumType, number>,
  note: string,
  activityId: string,
  userId: string
): Promise<string | null> {
  for (const [type, delta] of deltas) {
    const stock = await tx.inventory.findUnique({ where: { type } });
    const prevQty = stock?.quantity ?? 0;

    if (prevQty + delta < 0) {
      return `That change needs ${formatWeight(-delta)} of ${materialLabel(type)} to come back out of stock, but only ${formatWeight(prevQty)} is there - some has already been re-melted.`;
    }

    await tx.inventory.upsert({
      where: { type },
      update: { quantity: { increment: delta }, lastUpdated: new Date() },
      create: { type, quantity: Math.max(0, delta) },
    });

    await tx.inventoryLog.create({
      data: {
        type,
        action: delta > 0 ? "ADD" : "ADJUST",
        quantity: delta,
        previousQty: prevQty,
        newQty: prevQty + delta,
        reference: "Fettling",
        referenceId: activityId,
        notes: note,
        createdBy: userId,
      },
    });
  }
  return null;
}

/** Activity types are rows now, so validity is a lookup rather than an enum. */
async function activityTypeExists(id: string): Promise<boolean> {
  const type = await prisma.activityType.findUnique({ where: { id } });
  return Boolean(type?.isActive);
}

// GET - List activities, filtered by date range / employee / operation
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canRead(session, "fettling")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }
const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const employeeId = searchParams.get("employeeId");
    const activityTypeId = searchParams.get("activityTypeId");

    const where: Prisma.FettlingActivityWhereInput = {};

    if (from || to) {
      const gte = from ? parseDateOnly(from) : null;
      const lte = to ? parseDateOnly(to) : null;
      where.date = {
        ...(gte ? { gte } : {}),
        ...(lte ? { lte } : {}),
      };
    }
    if (employeeId) where.employeeId = employeeId;
    if (activityTypeId) {
      where.activityTypeId = activityTypeId;
    }

    const activities = await prisma.fettlingActivity.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: {
        employee: { select: { id: true, name: true, employeeCode: true } },
        activityType: { select: { id: true, name: true } },
        items: {
          include: {
            part: {
              select: { id: true, name: true, partCode: true, weightPerPiece: true },
            },
          },
        },
        user: { select: { name: true } },
      },
    });

    // Totals for the filtered window, grouped by activity and by employee
    const activityTotals = new Map<
      string,
      {
        activityTypeId: string;
        name: string;
        parts: number;
        rejected: number;
        entries: number;
      }
    >();
    for (const a of activities) {
      const current = activityTotals.get(a.activityTypeId) ?? {
        activityTypeId: a.activityTypeId,
        name: a.activityType.name,
        parts: 0,
        rejected: 0,
        entries: 0,
      };
      current.parts += a.partsCompleted;
      current.rejected += a.partsRejected;
      current.entries += 1;
      activityTotals.set(a.activityTypeId, current);
    }
    const byActivity = [...activityTotals.values()];

    const employeeTotals = new Map<
      string,
      {
        employeeId: string;
        name: string;
        employeeCode: string;
        parts: number;
        rejected: number;
        entries: number;
      }
    >();
    for (const a of activities) {
      const current = employeeTotals.get(a.employeeId) ?? {
        employeeId: a.employeeId,
        name: a.employee.name,
        employeeCode: a.employee.employeeCode,
        parts: 0,
        rejected: 0,
        entries: 0,
      };
      current.parts += a.partsCompleted;
      current.rejected += a.partsRejected;
      current.entries += 1;
      employeeTotals.set(a.employeeId, current);
    }

    return NextResponse.json({
      success: true,
      data: activities,
      summary: {
        totalParts: activities.reduce((sum, a) => sum + a.partsCompleted, 0),
        totalRejected: activities.reduce((sum, a) => sum + a.partsRejected, 0),
        totalAccepted: activities.reduce(
          (sum, a) => sum + (a.partsCompleted - a.partsRejected),
          0
        ),
        totalEntries: activities.length,
        byActivity,
        byEmployee: [...employeeTotals.values()].sort((a, b) => b.parts - a.parts),
      },
    });
  } catch (error) {
    console.error("Error fetching fettling activities:", error);
    return NextResponse.json(
      { error: "Failed to fetch fettling activities" },
      { status: 500 }
    );
  }
}

// POST - Record a day's output for an employee
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    if (!canWrite(session, "fettling")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }
if (!canRecordFettlingActivity(session)) {
      return NextResponse.json(
        { error: "Only an admin or fettling manager can record activity" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { employeeId, activityTypeId: bodyActivityTypeId, date, items, notes } = body;

    if (!employeeId || !bodyActivityTypeId || !date) {
      return NextResponse.json(
        { error: "Employee, activity and date are required" },
        { status: 400 }
      );
    }

    if (!(await activityTypeExists(bodyActivityTypeId))) {
      return NextResponse.json(
        { error: "Activity not found or inactive" },
        { status: 400 }
      );
    }

    const workDate = parseDateOnly(String(date));
    if (!workDate) {
      return NextResponse.json(
        { error: "Date must be in YYYY-MM-DD format" },
        { status: 400 }
      );
    }

    if (!canEditSheetForDate(session, workDate)) {
      return NextResponse.json({ error: SHEET_LOCKED_MESSAGE }, { status: 403 });
    }

    const parsed = await normaliseItems(items, bodyActivityTypeId);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    if (!employee.isActive) {
      return NextResponse.json(
        { error: "Cannot record activity for an inactive employee" },
        { status: 400 }
      );
    }

    // One record per employee per day, so a second entry for the same day is a
    // correction of the first rather than a new row
    const clash = await prisma.fettlingActivity.findUnique({
      where: { employeeId_date: { employeeId, date: workDate } },
    });
    if (clash) {
      return NextResponse.json(
        {
          error: `${employee.name} already has an entry for this day - open it and edit instead`,
        },
        { status: 409 }
      );
    }

    // A rejected casting is scrap metal, so the entry and the stock movement
    // are one act - either both land or neither does
    const activity = await prisma.$transaction(async (tx) => {
      const created = await tx.fettlingActivity.create({
        data: {
          employeeId,
          activityTypeId: bodyActivityTypeId,
          date: workDate,
          partsCompleted: parsed.completed,
          partsRejected: parsed.rejected,
          items: { create: parsed.items },
          notes: notes?.trim() || null,
          recordedBy: session.id,
        },
        include: {
          employee: { select: { id: true, name: true, employeeCode: true } },
          activityType: { select: { id: true, name: true } },
          items: {
            include: {
              part: {
                select: { id: true, name: true, partCode: true, weightPerPiece: true },
              },
            },
          },
          user: { select: { name: true } },
        },
      });

      const moves = fettlingScrapMovements(
        parsed.items.map((i) => ({
          partsRejected: i.partsRejected,
          reworkQty: i.reworkQty,
          rejectedWeight: i.rejectedWeight,
          part: parsed.parts.get(i.partId)!,
        }))
      );

      const failure = await applyScrapDeltas(
        tx,
        moves,
        `Rejected at fettling - ${employee.name}, ${toDateOnlyString(workDate)}`,
        created.id,
        session.id
      );
      if (failure) throw new MovementRefused(failure);

      /*
       * The pieces move along the route.
       *
       * This is the whole point of the entry: the same castings leave this
       * station and arrive at the next one. They are not new pieces, which is
       * what the old count-them-up approach assumed, and why ten castings
       * through two stations read as twenty parts.
       */
      const processNames = await processNamesFor(parsed.routes);
      const pieceRefusal = await applyStageMoves(
        tx,
        fettlingMoves(parsed.items, parsed.routes),
        {
          reference: "FETTLING",
          referenceId: created.id,
          notes: `${employee.name}, ${toDateOnlyString(workDate)}`,
          userId: session.id,
          describe: (partId, stageKey) =>
            describeStage(stageKey, parsed.routes.get(partId) ?? [], processNames),
          partLabel: (partId) => parsed.partCodes.get(partId) ?? "that part",
        }
      );
      if (pieceRefusal) throw new MovementRefused(pieceRefusal);

      return created;
    });

    return NextResponse.json({ success: true, data: activity }, { status: 201 });
  } catch (error) {
    if (error instanceof MovementRefused) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error recording fettling activity:", error);
    return NextResponse.json(
      { error: "Failed to record fettling activity" },
      { status: 500 }
    );
  }
}

// PUT - Amend a recorded activity
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    if (!canWrite(session, "fettling")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }
if (!canRecordFettlingActivity(session)) {
      return NextResponse.json(
        { error: "Only an admin or fettling manager can amend activity" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { id, activityTypeId: putActivityTypeId, date, items, notes } = body;

    if (!id) {
      return NextResponse.json({ error: "Activity ID is required" }, { status: 400 });
    }

    const existing = await prisma.fettlingActivity.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    if (
      putActivityTypeId !== undefined &&
      !(await activityTypeExists(putActivityTypeId))
    ) {
      return NextResponse.json(
        { error: "Activity not found or inactive" },
        { status: 400 }
      );
    }

    let workDate: Date | undefined;
    if (date !== undefined) {
      const parsedDate = parseDateOnly(String(date));
      if (!parsedDate) {
        return NextResponse.json(
          { error: "Date must be in YYYY-MM-DD format" },
          { status: 400 }
        );
      }
      workDate = parsedDate;
    }

    // Both the day being amended and the day it would move to must be editable
    if (!canEditSheetForDate(session, existing.date)) {
      return NextResponse.json({ error: SHEET_LOCKED_MESSAGE }, { status: 403 });
    }
    if (workDate && !canEditSheetForDate(session, workDate)) {
      return NextResponse.json({ error: SHEET_LOCKED_MESSAGE }, { status: 403 });
    }

    // The lines are replaced wholesale when they are sent. Patching them
    // individually would need a per-line id in the payload for no gain - the
    // form always holds the whole day's work anyway.
    let parsed: Awaited<ReturnType<typeof normaliseItems>> | null = null;
    if (items !== undefined) {
      // The process may be changing in the same edit; the lines belong to
      // whichever one the day is being saved as
      parsed = await normaliseItems(
        items,
        putActivityTypeId ?? existing.activityTypeId
      );
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // What the entry was responsible for before it changed - both the scrap
      // it booked and the pieces it moved
      const before = await movementsFor(id);
      const piecesBefore = await pieceMovementsFor(id);

      const result = await tx.fettlingActivity.update({
        where: { id },
        data: {
          ...(putActivityTypeId !== undefined ? { activityTypeId: putActivityTypeId } : {}),
          ...(workDate !== undefined ? { date: workDate } : {}),
          ...(parsed?.ok
            ? {
                partsCompleted: parsed.completed,
                partsRejected: parsed.rejected,
                items: { deleteMany: {}, create: parsed.items },
              }
            : {}),
          ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
        },
        include: {
          employee: { select: { id: true, name: true, employeeCode: true } },
          activityType: { select: { id: true, name: true } },
          items: {
            include: {
              part: {
                select: { id: true, name: true, partCode: true, weightPerPiece: true },
              },
            },
          },
          user: { select: { name: true } },
        },
      });

      // Only the difference moves. A correction that leaves the rejects alone
      // writes nothing at all.
      if (parsed?.ok) {
        const after = fettlingScrapMovements(
          parsed.items.map((i) => ({
            partsRejected: i.partsRejected,
            reworkQty: i.reworkQty,
            rejectedWeight: i.rejectedWeight,
            part: parsed.parts.get(i.partId)!,
          }))
        );

        const failure = await applyScrapDeltas(
          tx,
          scrapDelta(before, after),
          `Corrected at fettling - ${result.employee.name}, ${toDateOnlyString(result.date)}`,
          id,
          session.id
        );
        if (failure) throw new MovementRefused(failure);

        /*
         * Only the change in pieces is applied.
         *
         * Correcting 10 down to 6 hands 4 back to this station and takes 4 off
         * the next one - and is refused if that station has already worked
         * them, because those pieces are past the point where this entry can
         * speak for them.
         */
        const piecesAfter = fettlingMoves(parsed.items, parsed.routes);
        const routes = new Map([...piecesBefore.routes, ...parsed.routes]);
        const processNames = await processNamesFor(routes);

        const pieceRefusal = await applyStageMoves(
          tx,
          stageDelta(piecesBefore.moves, piecesAfter),
          {
            reference: "FETTLING",
            referenceId: id,
            notes: `Corrected - ${result.employee.name}, ${toDateOnlyString(result.date)}`,
            userId: session.id,
            describe: (partId, stageKey) =>
              describeStage(stageKey, routes.get(partId) ?? [], processNames),
            partLabel: (partId) => parsed.partCodes.get(partId) ?? "that part",
          }
        );
        if (pieceRefusal) throw new MovementRefused(pieceRefusal);
      }

      return result;
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    // A refusal carries its own reason - something the operator can act on,
    // not a server fault. Matching on the message text used to be how this
    // was told apart; the error type says it outright now.
    if (error instanceof MovementRefused) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error updating fettling activity:", error);
    return NextResponse.json(
      { error: "Failed to update fettling activity" },
      { status: 500 }
    );
  }
}

// DELETE - Remove a recorded activity
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    if (!canWrite(session, "fettling")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }
if (!canRecordFettlingActivity(session)) {
      return NextResponse.json(
        { error: "Only an admin or fettling manager can delete activity" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Activity ID is required" }, { status: 400 });
    }

    const existing = await prisma.fettlingActivity.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    if (!canEditSheetForDate(session, existing.date)) {
      return NextResponse.json({ error: SHEET_LOCKED_MESSAGE }, { status: 403 });
    }

    await prisma.$transaction(async (tx) => {
      // The scrap this entry booked in has to come back out. Reversing before
      // the delete, because the items are what say how much.
      const before = await movementsFor(id);
      const reversal = new Map(
        [...before].map(([type, amount]) => [type, -amount] as const)
      );
      const piecesBefore = await pieceMovementsFor(id);

      const employee = await tx.employee.findUnique({
        where: { id: existing.employeeId },
        select: { name: true },
      });

      const failure = await applyScrapDeltas(
        tx,
        reversal,
        `Reversed - fettling entry for ${employee?.name ?? "an employee"} on ${toDateOnlyString(existing.date)} was deleted`,
        id,
        session.id
      );
      if (failure) throw new MovementRefused(failure);

      // The pieces go back to the station they were taken from. Refused if the
      // next station has already worked them - undoing this entry would then
      // be claiming pieces that have moved on.
      const processNames = await processNamesFor(piecesBefore.routes);
      const partCodes = new Map(
        (
          await tx.part.findMany({
            where: { id: { in: [...piecesBefore.routes.keys()] } },
            select: { id: true, partCode: true },
          })
        ).map((p) => [p.id, p.partCode])
      );

      const pieceRefusal = await applyStageMoves(
        tx,
        reverseMoves(piecesBefore.moves),
        {
          reference: "FETTLING",
          referenceId: id,
          notes: `Reversed - entry deleted`,
          userId: session.id,
          describe: (partId, stageKey) =>
            describeStage(stageKey, piecesBefore.routes.get(partId) ?? [], processNames),
          partLabel: (partId) => partCodes.get(partId) ?? "that part",
        }
      );
      if (pieceRefusal) throw new MovementRefused(pieceRefusal);

      await tx.fettlingActivity.delete({ where: { id } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof MovementRefused) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error deleting fettling activity:", error);
    return NextResponse.json(
      { error: "Failed to delete fettling activity" },
      { status: 500 }
    );
  }
}
