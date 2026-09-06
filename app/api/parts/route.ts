import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { parsePagination, buildPaginationMeta } from "@/lib/pagination";
import { Prisma } from "@prisma/client";

// GET - List all parts
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canRead(session, "parts")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }
const { searchParams } = new URL(request.url);
    const { paginated, page, pageSize, skip, take } = parsePagination(searchParams);
    const search = searchParams.get("search")?.trim();

    // Search is applied in the database so it spans every page, not just the
    // rows already loaded in the browser.
    const where: Prisma.PartWhereInput = {
      isActive: true,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { partCode: { contains: search, mode: "insensitive" as const } },
              { description: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    // Unpaginated callers (the production part dropdown) still get everything
    if (!paginated) {
      const parts = await prisma.part.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ success: true, data: parts });
    }

    const [parts, total] = await Promise.all([
      prisma.part.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.part.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: parts,
      pagination: buildPaginationMeta(total, { page, pageSize }),
    });
  } catch (error) {
    console.error("Error fetching parts:", error);
    return NextResponse.json(
      { error: "Failed to fetch parts" },
      { status: 500 }
    );
  }
}

// POST - Create new part
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canWrite(session, "parts")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { partCode, name, description, weightPerPiece, expectedScrap } = body;

    if (!partCode || !name || !weightPerPiece) {
      return NextResponse.json(
        { error: "Part code, name, and weight are required" },
        { status: 400 }
      );
    }

    const existingPart = await prisma.part.findUnique({
      where: { partCode },
    });

    if (existingPart) {
      return NextResponse.json(
        { error: "Part code already exists" },
        { status: 400 }
      );
    }

    const part = await prisma.part.create({
      data: {
        partCode,
        name,
        description: description || null,
        weightPerPiece: parseFloat(weightPerPiece),
        expectedScrap: parseFloat(expectedScrap) || 0,
        isActive: true,
      },
    });

    return NextResponse.json({ success: true, data: part }, { status: 201 });
  } catch (error) {
    console.error("Error creating part:", error);
    return NextResponse.json(
      { error: "Failed to create part" },
      { status: 500 }
    );
  }
}

// PUT - Update part
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canWrite(session, "parts")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { id, partCode, name, description, weightPerPiece, expectedScrap, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: "Part ID is required" }, { status: 400 });
    }

    const part = await prisma.part.update({
      where: { id },
      data: {
        partCode,
        name,
        description,
        weightPerPiece: parseFloat(weightPerPiece),
        expectedScrap: parseFloat(expectedScrap) || 0,
        isActive: isActive ?? true,
      },
    });

    return NextResponse.json({ success: true, data: part });
  } catch (error) {
    console.error("Error updating part:", error);
    return NextResponse.json(
      { error: "Failed to update part" },
      { status: 500 }
    );
  }
}

// DELETE - Soft delete part
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canWrite(session, "parts")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Part ID is required" }, { status: 400 });
    }

    await prisma.part.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true, message: "Part deleted" });
  } catch (error) {
    console.error("Error deleting part:", error);
    return NextResponse.json(
      { error: "Failed to delete part" },
      { status: 500 }
    );
  }
}
