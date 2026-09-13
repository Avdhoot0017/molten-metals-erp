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
import type { AluminumType } from "@/types";
import { Prisma } from "@prisma/client";

export interface NormalisedItem {
  partId: string;
  partsCompleted: number;
  partsRejected: number;
  /** Weighed scrap in grams, or null to use count x the part's weight. */
  rejectedWeight: number | null;
}

/**
 * Validates the part lines of a day's work and rolls them up.
 *
 * An employee handles several parts in a shift, so the figures are per part
 * and the day's totals are their sum - stored rather than recomputed on every
 * read, because the dashboard aggregates these across months.
 */
export async function normaliseItems(
  raw: unknown
): Promise<
  | {
      ok: true;
      items: NormalisedItem[];
      completed: number;
      rejected: number;
      /** Weight and alloy per part, for booking the rejected scrap. */
      parts: Map<string, { weightPerPiece: number; alloyGrade: string }>;
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

    items.push({
      partId: line.partId,
      partsCompleted: done,
      partsRejected: rejected,
      rejectedWeight,
    });
  }

  const known = await prisma.part.findMany({
    where: { id: { in: items.map((i) => i.partId) } },
    select: { id: true, weightPerPiece: true, alloyGrade: true },
  });
  if (known.length !== items.length) {
    return { ok: false, error: "Part not found" };
  }

  return {
    ok: true,
    items,
    completed: items.reduce((sum, i) => sum + i.partsCompleted, 0),
    rejected: items.reduce((sum, i) => sum + i.partsRejected, 0),
    parts: new Map(
      known.map((p) => [
        p.id,
        { weightPerPiece: p.weightPerPiece, alloyGrade: p.alloyGrade },
      ])
    ),
  };
}

/** The rejected-scrap movements an entry, as stored, is responsible for. */
async function movementsFor(activityId: string) {
  const items = await prisma.fettlingActivityItem.findMany({
    where: { activityId },
    include: { part: { select: { weightPerPiece: true, alloyGrade: true } } },
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

    const parsed = await normaliseItems(items);
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
      if (failure) throw new Error(failure);

      return created;
    });

    return NextResponse.json({ success: true, data: activity }, { status: 201 });
  } catch (error) {
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
      parsed = await normaliseItems(items);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // What the entry was responsible for before it changed
      const before = await movementsFor(id);

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
        if (failure) throw new Error(failure);
      }

      return result;
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating fettling activity:", error);
    // applyScrapDeltas refuses by throwing its reason, which is a 400 the
    // operator can act on rather than an opaque server error
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("come back out of stock")) {
      return NextResponse.json({ error: reason }, { status: 400 });
    }
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
      if (failure) throw new Error(failure);

      await tx.fettlingActivity.delete({ where: { id } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting fettling activity:", error);
    // applyScrapDeltas refuses by throwing its reason, which is a 400 the
    // operator can act on rather than an opaque server error
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("come back out of stock")) {
      return NextResponse.json({ error: reason }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Failed to delete fettling activity" },
      { status: 500 }
    );
  }
}
