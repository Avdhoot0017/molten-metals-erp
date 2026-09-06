import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession, canRecordFettlingActivity } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import {
  parseDateOnly,
  canEditSheetForDate,
  SHEET_LOCKED_MESSAGE,
} from "@/lib/fettling";
import { Prisma } from "@prisma/client";

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
        part: { select: { id: true, name: true, partCode: true } },
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
    const { employeeId, activityTypeId: bodyActivityTypeId, date, partId, partsCompleted, partsRejected, notes } = body;

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

    const count = Number(partsCompleted);
    if (!Number.isInteger(count) || count < 0) {
      return NextResponse.json(
        { error: "Parts completed must be a whole number of 0 or more" },
        { status: 400 }
      );
    }

    // Blank means none were rejected - the common case, not an error
    const rejected =
      partsRejected === null || partsRejected === undefined || partsRejected === ""
        ? 0
        : Number(partsRejected);
    if (!Number.isInteger(rejected) || rejected < 0) {
      return NextResponse.json(
        { error: "Rejected parts must be a whole number of 0 or more" },
        { status: 400 }
      );
    }
    if (rejected > count) {
      return NextResponse.json(
        { error: "Rejected parts cannot exceed parts done" },
        { status: 400 }
      );
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

    if (partId) {
      const part = await prisma.part.findUnique({ where: { id: partId } });
      if (!part) {
        return NextResponse.json({ error: "Part not found" }, { status: 404 });
      }
    }

    const activity = await prisma.fettlingActivity.create({
      data: {
        employeeId,
        activityTypeId: bodyActivityTypeId,
        date: workDate,
        partId: partId || null,
        partsCompleted: count,
        partsRejected: rejected,
        notes: notes?.trim() || null,
        recordedBy: session.id,
      },
      include: {
        employee: { select: { id: true, name: true, employeeCode: true } },
        activityType: { select: { id: true, name: true } },
        part: { select: { id: true, name: true, partCode: true } },
        user: { select: { name: true } },
      },
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
    const { id, activityTypeId: putActivityTypeId, date, partId, partsCompleted, partsRejected, notes } = body;

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
      const parsed = parseDateOnly(String(date));
      if (!parsed) {
        return NextResponse.json(
          { error: "Date must be in YYYY-MM-DD format" },
          { status: 400 }
        );
      }
      workDate = parsed;
    }

    // Both the day being amended and the day it would move to must be editable
    if (!canEditSheetForDate(session, existing.date)) {
      return NextResponse.json({ error: SHEET_LOCKED_MESSAGE }, { status: 403 });
    }
    if (workDate && !canEditSheetForDate(session, workDate)) {
      return NextResponse.json({ error: SHEET_LOCKED_MESSAGE }, { status: 403 });
    }

    let count: number | undefined;
    if (partsCompleted !== undefined) {
      count = Number(partsCompleted);
      if (!Number.isInteger(count) || count < 0) {
        return NextResponse.json(
          { error: "Parts completed must be a whole number of 0 or more" },
          { status: 400 }
        );
      }
    }

    let rejected: number | undefined;
    if (partsRejected !== undefined) {
      rejected = partsRejected === null || partsRejected === "" ? 0 : Number(partsRejected);
      if (!Number.isInteger(rejected) || rejected < 0) {
        return NextResponse.json(
          { error: "Rejected parts must be a whole number of 0 or more" },
          { status: 400 }
        );
      }
    }

    // Either figure may be the one being amended, so the check is against
    // whichever value will actually be stored
    const finalCount = count ?? existing.partsCompleted;
    const finalRejected = rejected ?? existing.partsRejected;
    if (finalRejected > finalCount) {
      return NextResponse.json(
        { error: "Rejected parts cannot exceed parts done" },
        { status: 400 }
      );
    }

    const updated = await prisma.fettlingActivity.update({
      where: { id },
      data: {
        ...(putActivityTypeId !== undefined ? { activityTypeId: putActivityTypeId } : {}),
        ...(workDate !== undefined ? { date: workDate } : {}),
        ...(partId !== undefined ? { partId: partId || null } : {}),
        ...(count !== undefined ? { partsCompleted: count } : {}),
        ...(rejected !== undefined ? { partsRejected: rejected } : {}),
        ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
      },
      include: {
        employee: { select: { id: true, name: true, employeeCode: true } },
        activityType: { select: { id: true, name: true } },
        part: { select: { id: true, name: true, partCode: true } },
        user: { select: { name: true } },
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
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

    await prisma.fettlingActivity.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting fettling activity:", error);
    return NextResponse.json(
      { error: "Failed to delete fettling activity" },
      { status: 500 }
    );
  }
}
