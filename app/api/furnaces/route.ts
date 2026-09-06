import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";

// GET - List furnaces (any signed-in user; the production form needs them)
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canRead(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }
const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("includeInactive") === "true";

    const furnaces = await prisma.furnace.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });

    // How many batches each furnace still has open. A furnace can only hold so
    // much unfinished paperwork before the records stop meaning anything, so
    // the production form uses this to stop a fourth being opened on it.
    const openBatches = await prisma.productionRecord.groupBy({
      by: ["furnaceId"],
      where: { status: { in: ["PENDING", "UPDATED"] } },
      _count: { _all: true },
    });
    const openByFurnace = new Map(
      openBatches.map((row) => [row.furnaceId, row._count._all])
    );

    return NextResponse.json({
      success: true,
      data: furnaces.map((f) => ({
        ...f,
        openBatches: openByFurnace.get(f.id) ?? 0,
      })),
    });
  } catch (error) {
    console.error("Error fetching furnaces:", error);
    return NextResponse.json(
      { error: "Failed to fetch furnaces" },
      { status: 500 }
    );
  }
}

// POST - Add a furnace (admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    if (!canWrite(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const { name } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json({ error: "Furnace name is required" }, { status: 400 });
    }

    const existing = await prisma.furnace.findUnique({ where: { name: name.trim() } });
    if (existing) {
      return NextResponse.json(
        { error: "A furnace with this name already exists" },
        { status: 409 }
      );
    }

    const furnace = await prisma.furnace.create({ data: { name: name.trim() } });
    return NextResponse.json({ success: true, data: furnace }, { status: 201 });
  } catch (error) {
    console.error("Error creating furnace:", error);
    return NextResponse.json({ error: "Failed to create furnace" }, { status: 500 });
  }
}

// PUT - Rename or activate/deactivate a furnace (admin only)
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    if (!canWrite(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const { id, name, isActive } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "Furnace ID is required" }, { status: 400 });
    }

    const furnace = await prisma.furnace.findUnique({ where: { id } });
    if (!furnace) {
      return NextResponse.json({ error: "Furnace not found" }, { status: 404 });
    }

    if (name !== undefined) {
      if (!name.trim()) {
        return NextResponse.json(
          { error: "Furnace name cannot be empty" },
          { status: 400 }
        );
      }
      if (name.trim() !== furnace.name) {
        const clash = await prisma.furnace.findUnique({ where: { name: name.trim() } });
        if (clash) {
          return NextResponse.json(
            { error: "A furnace with this name already exists" },
            { status: 409 }
          );
        }
      }
    }

    const updated = await prisma.furnace.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating furnace:", error);
    return NextResponse.json({ error: "Failed to update furnace" }, { status: 500 });
  }
}

// DELETE - Remove a furnace (admin only).
// Furnaces already used by a batch are deactivated instead, so history is kept.
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    if (!canWrite(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Furnace ID is required" }, { status: 400 });
    }

    const furnace = await prisma.furnace.findUnique({ where: { id } });
    if (!furnace) {
      return NextResponse.json({ error: "Furnace not found" }, { status: 404 });
    }

    const usedBy = await prisma.productionRecord.count({ where: { furnaceId: id } });
    if (usedBy > 0) {
      await prisma.furnace.update({ where: { id }, data: { isActive: false } });
      return NextResponse.json({
        success: true,
        deactivated: true,
        message: `Furnace is used by ${usedBy} batch(es), so it was deactivated instead of deleted`,
      });
    }

    await prisma.furnace.delete({ where: { id } });
    return NextResponse.json({ success: true, deactivated: false });
  } catch (error) {
    console.error("Error deleting furnace:", error);
    return NextResponse.json({ error: "Failed to delete furnace" }, { status: 500 });
  }
}
