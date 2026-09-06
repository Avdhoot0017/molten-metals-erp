import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { parseDateOnly, canEditSheetForDate, todayUtc } from "@/lib/fettling";


/**
 * GET - One day's fettling: every active employee, with whatever has been
 * recorded for them, broken down by part.
 *
 * Read-only. Entries are created and edited one employee at a time through
 * /api/fettling, so there is no second write path here to drift out of step
 * with the validation that lives there.
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
          items: {
            include: { part: { select: { id: true, name: true, partCode: true } } },
          },
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
        // The per-part breakdown, so the list can show what was worked on
        // without a second request per row
        items: entry?.items ?? [],
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
