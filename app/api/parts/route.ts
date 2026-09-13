import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { GRADE_NAMES } from "@/lib/ingot";
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

/**
 * Validates the two weights a part is described by.
 *
 * Expected scrap is not among them: it is the gating poured with the casting
 * and cut off again, so it is exactly the difference between these two, and
 * lib/parts.ts works it out wherever it is shown. Nothing writes it, so nothing
 * can write a value that contradicts the weights.
 *
 * Both inputs arrive in grams; callers convert from the kg the operator types.
 */
function castingWeights(
  weightPerPieceInput: unknown,
  pouringWeightInput: unknown
): { ok: true; value: { weightPerPiece: number; pouringWeight: number | null } } | { ok: false; error: string } {
  const weightPerPiece = parseFloat(String(weightPerPieceInput));
  if (!Number.isFinite(weightPerPiece) || weightPerPiece <= 0) {
    return { ok: false, error: "Part weight must be a number greater than zero" };
  }

  // Left blank stays blank. A part whose gating nobody has measured is a real
  // state, and null records it honestly - substituting the finished weight
  // would assert the mould takes no extra metal, which is never true.
  if (pouringWeightInput === undefined || pouringWeightInput === null || pouringWeightInput === "") {
    return { ok: true, value: { weightPerPiece, pouringWeight: null } };
  }

  const pouringWeight = parseFloat(String(pouringWeightInput));
  if (!Number.isFinite(pouringWeight) || pouringWeight <= 0) {
    return { ok: false, error: "Pouring weight must be a number greater than zero" };
  }

  // Less metal poured than the casting weighs is not a tolerance question -
  // it is a typo, and it would otherwise produce negative expected scrap.
  if (pouringWeight < weightPerPiece) {
    return {
      ok: false,
      error: "Pouring weight cannot be less than the finished part weight - the gating is poured on top of the casting",
    };
  }

  return { ok: true, value: { weightPerPiece, pouringWeight } };
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
    const { partCode, name, description, weightPerPiece, pouringWeight, alloyGrade } = body;

    // The alloy decides which scrap line a rejected casting is booked to, so
    // an unknown one would quietly send metal to the wrong place
    if (alloyGrade !== undefined && !GRADE_NAMES.includes(String(alloyGrade))) {
      return NextResponse.json(
        { error: `Alloy must be one of ${GRADE_NAMES.join(", ")}` },
        { status: 400 }
      );
    }

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

    const weights = castingWeights(weightPerPiece, pouringWeight);
    if (!weights.ok) {
      return NextResponse.json({ error: weights.error }, { status: 400 });
    }

    const part = await prisma.part.create({
      data: {
        partCode,
        name,
        description: description || null,
        ...weights.value,
        ...(alloyGrade !== undefined ? { alloyGrade: String(alloyGrade) } : {}),
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
    const { id, partCode, name, description, weightPerPiece, pouringWeight, isActive, alloyGrade } = body;

    if (!id) {
      return NextResponse.json({ error: "Part ID is required" }, { status: 400 });
    }

    // Same check as on create - an unknown alloy would send a rejected
    // casting's metal to a stock line that does not exist
    if (alloyGrade !== undefined && !GRADE_NAMES.includes(String(alloyGrade))) {
      return NextResponse.json(
        { error: `Alloy must be one of ${GRADE_NAMES.join(", ")}` },
        { status: 400 }
      );
    }

    const weights = castingWeights(weightPerPiece, pouringWeight);
    if (!weights.ok) {
      return NextResponse.json({ error: weights.error }, { status: 400 });
    }

    const part = await prisma.part.update({
      where: { id },
      data: {
        partCode,
        name,
        description,
        ...weights.value,
        ...(alloyGrade !== undefined ? { alloyGrade: String(alloyGrade) } : {}),
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
