import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession, canRecordFettlingActivity } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import {
  parseDateOnly,
  canEditSheetForDate,
  todayUtc,
  SHEET_LOCKED_MESSAGE,
} from "@/lib/fettling";


/**
 * GET - The daily sheet for one date: every active employee with whatever has
 * already been recorded for them that day. Drives the attendance-style grid.
 */
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
    const dateParam = searchParams.get("date");
    if (!dateParam) {
      return NextResponse.json(
        { error: "A date in YYYY-MM-DD format is required" },
        { status: 400 }
      );
    }

    const date = parseDateOnly(dateParam);
    if (!date) {
      return NextResponse.json(
        { error: "Date must be in YYYY-MM-DD format" },
        { status: 400 }
      );
    }

    const [employees, activities] = await Promise.all([
      prisma.employee.findMany({
        where: { isActive: true },
        orderBy: [{ activityType: { sortOrder: "asc" } }, { employeeCode: "asc" }],
        include: { activityType: { select: { id: true, name: true } } },
      }),
      prisma.fettlingActivity.findMany({
        where: { date },
        include: {
          user: { select: { name: true } },
          activityType: { select: { id: true, name: true } },
        },
      }),
    ]);

    const byEmployee = new Map(activities.map((a) => [a.employeeId, a]));

    const rows = employees.map((employee) => {
      const entry = byEmployee.get(employee.id);
      return {
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        name: employee.name,
        activityTypeId: employee.activityTypeId,
        activityTypeName: employee.activityType.name,
        // Falls back to the employee's assignment when nothing is recorded yet
        recordedActivityTypeId: entry?.activityTypeId ?? employee.activityTypeId,
        recordedActivityName: entry?.activityType.name ?? employee.activityType.name,
        partsCompleted: entry?.partsCompleted ?? null,
        partsRejected: entry?.partsRejected ?? null,
        notes: entry?.notes ?? "",
        activityId: entry?.id ?? null,
        recordedBy: entry?.user?.name ?? null,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        date: dateParam,
        isToday: date.getTime() === todayUtc().getTime(),
        editable: canEditSheetForDate(session, date),
        rows,
        totalParts: rows.reduce((sum, r) => sum + (r.partsCompleted ?? 0), 0),
        // Accepted is derived, never stored, so it cannot drift from the two
        // figures the operator actually typed
        totalRejected: rows.reduce((sum, r) => sum + (r.partsRejected ?? 0), 0),
        totalAccepted: rows.reduce(
          (sum, r) => sum + ((r.partsCompleted ?? 0) - (r.partsRejected ?? 0)),
          0
        ),
        filledCount: rows.filter((r) => r.partsCompleted !== null).length,
      },
    });
  } catch (error) {
    console.error("Error loading daily sheet:", error);
    return NextResponse.json(
      { error: "Failed to load daily sheet" },
      { status: 500 }
    );
  }
}

/**
 * POST - Save the whole sheet for a date in one go.
 * Rows with a blank count are treated as "no output recorded" and any existing
 * entry for that employee/day is removed.
 */
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
    const { date: dateParam, rows } = body;

    const date = parseDateOnly(String(dateParam ?? ""));
    if (!date) {
      return NextResponse.json(
        { error: "Date must be in YYYY-MM-DD format" },
        { status: 400 }
      );
    }

    // A fettling manager can only touch today's sheet
    if (!canEditSheetForDate(session, date)) {
      return NextResponse.json({ error: SHEET_LOCKED_MESSAGE }, { status: 403 });
    }

    if (!Array.isArray(rows)) {
      return NextResponse.json({ error: "rows must be an array" }, { status: 400 });
    }

    // Validate everything before writing anything
    const toUpsert: Array<{
      employeeId: string;
      activityTypeId: string;
      partsCompleted: number;
      partsRejected: number;
      notes: string | null;
    }> = [];
    const toClear: string[] = [];

    for (const row of rows) {
      if (!row?.employeeId) {
        return NextResponse.json(
          { error: "Every row needs an employeeId" },
          { status: 400 }
        );
      }

      const blank =
        row.partsCompleted === null ||
        row.partsCompleted === undefined ||
        row.partsCompleted === "";

      if (blank) {
        toClear.push(row.employeeId);
        continue;
      }

      const count = Number(row.partsCompleted);
      if (!Number.isInteger(count) || count < 0) {
        return NextResponse.json(
          {
            error: `Parts completed must be a whole number of 0 or more (employee ${row.employeeId})`,
          },
          { status: 400 }
        );
      }

      // Rejected is optional: a blank means none were rejected, which is the
      // common case and should not force the operator to type a zero.
      const rejected =
        row.partsRejected === null ||
        row.partsRejected === undefined ||
        row.partsRejected === ""
          ? 0
          : Number(row.partsRejected);

      if (!Number.isInteger(rejected) || rejected < 0) {
        return NextResponse.json(
          {
            error: `Rejected parts must be a whole number of 0 or more (employee ${row.employeeId})`,
          },
          { status: 400 }
        );
      }
      if (rejected > count) {
        return NextResponse.json(
          {
            error: `Rejected parts cannot exceed parts done (employee ${row.employeeId})`,
          },
          { status: 400 }
        );
      }

      if (!row.activityTypeId) {
        return NextResponse.json(
          { error: `Missing activity for employee ${row.employeeId}` },
          { status: 400 }
        );
      }

      toUpsert.push({
        employeeId: row.employeeId,
        activityTypeId: row.activityTypeId,
        partsCompleted: count,
        partsRejected: rejected,
        notes: row.notes?.trim() || null,
      });
    }

    // Guard against rows referencing unknown or inactive employees
    const employeeIds = [...toUpsert.map((r) => r.employeeId), ...toClear];
    const known = await prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, isActive: true },
    });
    const knownIds = new Set(known.filter((e) => e.isActive).map((e) => e.id));
    const unknown = employeeIds.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: "Sheet contains unknown or inactive employees" },
        { status: 400 }
      );
    }

    // Every activity referenced must exist and be active
    const activityIds = [...new Set(toUpsert.map((r) => r.activityTypeId))];
    if (activityIds.length > 0) {
      const known = await prisma.activityType.count({
        where: { id: { in: activityIds }, isActive: true },
      });
      if (known !== activityIds.length) {
        return NextResponse.json(
          { error: "Sheet references an unknown or inactive activity" },
          { status: 400 }
        );
      }
    }

    await prisma.$transaction([
      ...toUpsert.map((row) =>
        prisma.fettlingActivity.upsert({
          where: {
            employeeId_date: { employeeId: row.employeeId, date },
          },
          create: {
            employeeId: row.employeeId,
            activityTypeId: row.activityTypeId,
            date,
            partsCompleted: row.partsCompleted,
            partsRejected: row.partsRejected,
            notes: row.notes,
            recordedBy: session.id,
          },
          update: {
            activityTypeId: row.activityTypeId,
            partsCompleted: row.partsCompleted,
            partsRejected: row.partsRejected,
            notes: row.notes,
            recordedBy: session.id,
          },
        })
      ),
      prisma.fettlingActivity.deleteMany({
        where: { date, employeeId: { in: toClear } },
      }),
    ]);

    return NextResponse.json({
      success: true,
      saved: toUpsert.length,
      cleared: toClear.length,
    });
  } catch (error) {
    console.error("Error saving daily sheet:", error);
    return NextResponse.json(
      { error: "Failed to save daily sheet" },
      { status: 500 }
    );
  }
}
