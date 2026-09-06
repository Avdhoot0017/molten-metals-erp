import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";

// GET - List activity types (anyone who can see the fettling shop)
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canRead(session, "fettling") && !canRead(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("includeInactive") === "true";

    const types = await prisma.activityType.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({ success: true, data: types });
  } catch (error) {
    console.error("Error fetching activity types:", error);
    return NextResponse.json(
      { error: "Failed to fetch activity types" },
      { status: 500 }
    );
  }
}

// POST - Add an activity type (managed from Settings)
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canWrite(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have permission to manage activity types" },
        { status: 403 }
      );
    }

    const { name } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Activity name is required" },
        { status: 400 }
      );
    }

    const existing = await prisma.activityType.findUnique({
      where: { name: name.trim() },
    });
    if (existing) {
      return NextResponse.json(
        { error: "An activity with this name already exists" },
        { status: 409 }
      );
    }

    // New activities go to the end of the list
    const last = await prisma.activityType.findFirst({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const type = await prisma.activityType.create({
      data: { name: name.trim(), sortOrder: (last?.sortOrder ?? 0) + 1 },
    });

    return NextResponse.json({ success: true, data: type }, { status: 201 });
  } catch (error) {
    console.error("Error creating activity type:", error);
    return NextResponse.json(
      { error: "Failed to create activity type" },
      { status: 500 }
    );
  }
}

// PUT - Rename or activate/deactivate an activity type
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canWrite(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have permission to manage activity types" },
        { status: 403 }
      );
    }

    const { id, name, isActive } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "Activity ID is required" }, { status: 400 });
    }

    const type = await prisma.activityType.findUnique({ where: { id } });
    if (!type) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    if (name !== undefined) {
      if (!name.trim()) {
        return NextResponse.json(
          { error: "Activity name cannot be empty" },
          { status: 400 }
        );
      }
      if (name.trim() !== type.name) {
        const clash = await prisma.activityType.findUnique({
          where: { name: name.trim() },
        });
        if (clash) {
          return NextResponse.json(
            { error: "An activity with this name already exists" },
            { status: 409 }
          );
        }
      }
    }

    // Deactivating is blocked while employees are still assigned to it
    if (isActive === false) {
      const assigned = await prisma.employee.count({
        where: { activityTypeId: id, isActive: true },
      });
      if (assigned > 0) {
        return NextResponse.json(
          {
            error: `${assigned} active employee(s) are assigned to this activity. Move them first.`,
          },
          { status: 409 }
        );
      }
    }

    const updated = await prisma.activityType.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating activity type:", error);
    return NextResponse.json(
      { error: "Failed to update activity type" },
      { status: 500 }
    );
  }
}

// DELETE - Remove an activity type. Anything already referencing it is kept,
// so an in-use activity is deactivated instead of deleted.
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canWrite(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have permission to manage activity types" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Activity ID is required" }, { status: 400 });
    }

    const type = await prisma.activityType.findUnique({ where: { id } });
    if (!type) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    const [employees, activities] = await Promise.all([
      prisma.employee.count({ where: { activityTypeId: id } }),
      prisma.fettlingActivity.count({ where: { activityTypeId: id } }),
    ]);

    if (employees > 0 || activities > 0) {
      if (employees > 0) {
        return NextResponse.json(
          {
            error: `${employees} employee(s) are assigned to this activity. Move them before removing it.`,
          },
          { status: 409 }
        );
      }
      await prisma.activityType.update({ where: { id }, data: { isActive: false } });
      return NextResponse.json({
        success: true,
        deactivated: true,
        message: `Activity has ${activities} recorded entr(ies), so it was deactivated instead of deleted`,
      });
    }

    await prisma.activityType.delete({ where: { id } });
    return NextResponse.json({ success: true, deactivated: false });
  } catch (error) {
    console.error("Error deleting activity type:", error);
    return NextResponse.json(
      { error: "Failed to delete activity type" },
      { status: 500 }
    );
  }
}
