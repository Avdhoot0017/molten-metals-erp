import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  getSession,
  canManageEmployees,
  canReassignEmployeeTask,
} from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
/** Activity types are rows now, so validity is a lookup rather than an enum. */
async function activityTypeExists(id: string): Promise<boolean> {
  const type = await prisma.activityType.findUnique({ where: { id } });
  return Boolean(type?.isActive);
}

// GET - List employees, optionally filtered by operation / active state
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canRead(session, "employees")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }
const { searchParams } = new URL(request.url);
    const activityTypeId = searchParams.get("activityTypeId");
    const includeInactive = searchParams.get("includeInactive") === "true";

    const employees = await prisma.employee.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(activityTypeId ? { activityTypeId } : {}),
      },
      orderBy: [{ isActive: "desc" }, { employeeCode: "asc" }],
      include: { activityType: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ success: true, data: employees });
  } catch (error) {
    console.error("Error fetching employees:", error);
    return NextResponse.json(
      { error: "Failed to fetch employees" },
      { status: 500 }
    );
  }
}

// POST - Create an employee (roles with write access to employees)
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    if (!canWrite(session, "employees")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }
if (!canManageEmployees(session)) {
      return NextResponse.json(
        { error: "Only an admin or plant head can add employees" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { employeeCode, name, phone, activityTypeId } = body;

    if (!employeeCode?.trim() || !name?.trim() || !activityTypeId) {
      return NextResponse.json(
        { error: "Employee code, name and assigned activity are required" },
        { status: 400 }
      );
    }

    if (!(await activityTypeExists(activityTypeId))) {
      return NextResponse.json(
        { error: "Assigned activity not found or inactive" },
        { status: 400 }
      );
    }

    const existing = await prisma.employee.findUnique({
      where: { employeeCode: employeeCode.trim() },
    });
    if (existing) {
      return NextResponse.json(
        { error: "An employee with this code already exists" },
        { status: 409 }
      );
    }

    const employee = await prisma.employee.create({
      data: {
        employeeCode: employeeCode.trim(),
        name: name.trim(),
        phone: phone?.trim() || null,
        activityTypeId,
      },
      include: { activityType: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ success: true, data: employee }, { status: 201 });
  } catch (error) {
    console.error("Error creating employee:", error);
    return NextResponse.json(
      { error: "Failed to create employee" },
      { status: 500 }
    );
  }
}

// PUT - Update an employee.
// Task reassignment is additionally allowed for FETTLING_MANAGER; any other
// field change requires employee-management rights.
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { id, employeeCode, name, phone, activityTypeId, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
    }

    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const isTaskOnlyChange =
      activityTypeId !== undefined &&
      employeeCode === undefined &&
      name === undefined &&
      phone === undefined &&
      isActive === undefined;

    const allowed = isTaskOnlyChange
      ? canReassignEmployeeTask(session)
      : canManageEmployees(session);

    if (!allowed) {
      return NextResponse.json(
        {
          error: isTaskOnlyChange
            ? "You are not allowed to reassign tasks"
            : "Only an admin or plant head can edit employee details",
        },
        { status: 403 }
      );
    }

    if (
      activityTypeId !== undefined &&
      !(await activityTypeExists(activityTypeId))
    ) {
      return NextResponse.json(
        { error: "Assigned activity not found or inactive" },
        { status: 400 }
      );
    }

    if (employeeCode !== undefined && employeeCode.trim() !== employee.employeeCode) {
      const clash = await prisma.employee.findUnique({
        where: { employeeCode: employeeCode.trim() },
      });
      if (clash) {
        return NextResponse.json(
          { error: "An employee with this code already exists" },
          { status: 409 }
        );
      }
    }

    const updated = await prisma.employee.update({
      where: { id },
      include: { activityType: { select: { id: true, name: true } } },
      data: {
        ...(employeeCode !== undefined ? { employeeCode: employeeCode.trim() } : {}),
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(phone !== undefined ? { phone: phone?.trim() || null } : {}),
        ...(activityTypeId !== undefined ? { activityTypeId } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating employee:", error);
    return NextResponse.json(
      { error: "Failed to update employee" },
      { status: 500 }
    );
  }
}

// DELETE - Deactivate an employee (soft delete keeps their activity history)
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    if (!canWrite(session, "employees")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }
if (!canManageEmployees(session)) {
      return NextResponse.json(
        { error: "Only an admin or plant head can remove employees" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
    }

    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    await prisma.employee.update({ where: { id }, data: { isActive: false } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deactivating employee:", error);
    return NextResponse.json(
      { error: "Failed to deactivate employee" },
      { status: 500 }
    );
  }
}
