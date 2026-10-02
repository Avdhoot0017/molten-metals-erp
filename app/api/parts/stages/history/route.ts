import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { stageColumns } from "@/lib/pieces";

/**
 * Every movement of one part's pieces in a period, newest first.
 *
 * The detail behind a row on the shop-floor table: not just "12 at belt
 * sander" but how they got there - which batch cast them, whose entry moved
 * them, which count set them. A balance nobody can trace is a balance nobody
 * will trust, so the trail is one click from the figure.
 */

function dayBoundary(value: string | null, end: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Plain words for where a movement happened. */
function placeName(
  stageKey: string,
  steps: Map<string, { name: string; sequence: number }>
): string {
  const { kind, routeStepId } = stageColumns(stageKey);
  if (kind === "READY") return "Finished stock";
  const step = routeStepId ? steps.get(routeStepId) : undefined;
  // A step since removed from the route still has history; say so plainly
  const name = step ? `${step.sequence}. ${step.name}` : "A step no longer on the route";
  return kind === "REWORK" ? `Repair - from ${name}` : name;
}

const REFERENCE_LABELS: Record<string, string> = {
  PRODUCTION: "Cast",
  FETTLING: "Bench work",
  STOCKTAKE: "Count",
  ADJUST: "Adjustment",
};

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
    const partId = searchParams.get("partId");
    if (!partId) {
      return NextResponse.json({ error: "A part is required" }, { status: 400 });
    }
    const from = dayBoundary(searchParams.get("from"), false);
    const to = dayBoundary(searchParams.get("to"), true);

    const part = await prisma.part.findUnique({
      where: { id: partId },
      select: {
        routeSteps: {
          select: {
            id: true,
            sequence: true,
            activityType: { select: { name: true } },
          },
        },
      },
    });
    if (!part) {
      return NextResponse.json({ error: "Part not found" }, { status: 404 });
    }
    const steps = new Map(
      part.routeSteps.map((s) => [s.id, { name: s.activityType.name, sequence: s.sequence }])
    );

    const logs = await prisma.partStageLog.findMany({
      where: {
        partId,
        ...(from || to
          ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // A period of heavy work can run long; the latest is what gets read
      take: 300,
    });

    // The log keeps a user id rather than a relation, so names are looked up
    const userIds = [...new Set(logs.map((l) => l.createdBy))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const userName = new Map(users.map((u) => [u.id, u.name]));

    return NextResponse.json({
      success: true,
      data: logs.map((log) => ({
        id: log.id,
        at: log.createdAt,
        place: placeName(log.stageKey, steps),
        kind: stageColumns(log.stageKey).kind,
        change: log.quantity,
        before: log.previousQty,
        after: log.newQty,
        source: REFERENCE_LABELS[log.reference] ?? log.reference,
        notes: log.notes,
        by: userName.get(log.createdBy) ?? "Unknown",
      })),
      truncated: logs.length === 300,
    });
  } catch (error) {
    console.error("Error fetching piece history:", error);
    return NextResponse.json(
      { error: "Failed to load this part's history" },
      { status: 500 }
    );
  }
}
