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
    const status = searchParams.get("status")?.trim();
    const alloy = searchParams.get("alloy")?.trim();

    /*
     * Filters are applied in the database so they span every page, not just
     * the rows already loaded in the browser.
     *
     * Active-only stays the DEFAULT rather than the rule: the production form
     * reads this list to fill its part dropdown and must never offer a retired
     * part. But the catalogue has a Status column, and with the rule hard-coded
     * that column could only ever say "Active" - a retired part simply vanished
     * with nothing to say where it went.
     */
    const where: Prisma.PartWhereInput = {
      ...(status === "all" ? {} : { isActive: status !== "inactive" }),
      ...(alloy ? { alloyGrade: alloy } : {}),
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
        include: routeInclude,
      });
      return NextResponse.json({ success: true, data: parts });
    }

    /*
     * Headline figures for the catalogue page.
     *
     * Counted in the database over every part, not over the ten rows on
     * screen - the cards used to read "Total Parts 10, Active Parts 17",
     * because one was the page and the other the catalogue.
     */
    const summary = searchParams.get("summary") === "1"
      ? await (async () => {
          const [partCount, unmapped, madeByPart, readyStock] = await Promise.all([
            prisma.part.count({ where: { isActive: true } }),
            prisma.part.count({
              where: { isActive: true, routeSteps: { none: {} } },
            }),
            prisma.productionItem.groupBy({
              by: ["partId"],
              _sum: { quantityProduced: true },
              orderBy: { _sum: { quantityProduced: "desc" } },
              take: 1,
            }),
            prisma.partStage.aggregate({
              where: { stageKey: "READY" },
              _sum: { quantity: true },
            }),
          ]);

          const top = madeByPart[0];
          const topPart = top
            ? await prisma.part.findUnique({
                where: { id: top.partId },
                select: { partCode: true, name: true },
              })
            : null;

          const madeTotal = await prisma.productionItem.aggregate({
            _sum: { quantityProduced: true },
          });

          return {
            parts: partCount,
            /** Active parts nobody has mapped out yet - they cannot be tracked. */
            withoutSteps: unmapped,
            totalMade: madeTotal._sum.quantityProduced ?? 0,
            readyStock: readyStock._sum.quantity ?? 0,
            mostMade: topPart
              ? {
                  partCode: topPart.partCode,
                  name: topPart.name,
                  quantity: top?._sum.quantityProduced ?? 0,
                }
              : null,
          };
        })()
      : undefined;

    const [parts, total] = await Promise.all([
      prisma.part.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: routeInclude,
      }),
      prisma.part.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: parts,
      ...(summary ? { summary } : {}),
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
 * Validates a part's route - the ordered processes its castings pass through.
 *
 * The route is what makes piece tracking possible: ten castings moving through
 * three stations are ten pieces, not thirty, and knowing the order is the only
 * way to tell those apart. It is replaced wholesale on save rather than
 * patched step by step, so the stored sequence is always contiguous and in
 * order - there is no way to leave a gap behind.
 *
 * An empty route is allowed. A part that has not been mapped out yet is an
 * ordinary state, especially before the shop has worked through its catalogue.
 */
async function validateRoute(
  raw: unknown
): Promise<
  | { ok: true; steps: Array<{ activityTypeId: string; sequence: number }> }
  | { ok: false; error: string }
> {
  if (raw === undefined || raw === null) return { ok: true, steps: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "The route must be a list of processes" };
  }
  if (raw.length === 0) return { ok: true, steps: [] };

  const ids: string[] = [];
  for (const step of raw) {
    const id = typeof step === "string" ? step : step?.activityTypeId;
    if (!id || typeof id !== "string") {
      return { ok: false, error: "Every step in the route needs a process" };
    }
    // The same station twice would make an entry for it ambiguous - which of
    // the two is this? The database refuses it as well.
    if (ids.includes(id)) {
      return {
        ok: false,
        error: "A process can only appear once in a route",
      };
    }
    ids.push(id);
  }

  const known = await prisma.activityType.findMany({
    where: { id: { in: ids } },
    select: { id: true, isActive: true, name: true },
  });
  if (known.length !== ids.length) {
    return { ok: false, error: "That process no longer exists" };
  }
  const inactive = known.find((a) => !a.isActive);
  if (inactive) {
    return {
      ok: false,
      error: `${inactive.name} is switched off - turn it back on in Settings before routing parts through it`,
    };
  }

  // Position comes from the order they were sent in, so the caller never has
  // to keep sequence numbers straight
  return {
    ok: true,
    steps: ids.map((activityTypeId, index) => ({
      activityTypeId,
      sequence: index + 1,
    })),
  };
}

/** Route steps, in order, with the process named. */
const routeInclude = {
  routeSteps: {
    orderBy: { sequence: "asc" },
    include: { activityType: { select: { id: true, name: true } } },
  },
} satisfies Prisma.PartInclude;

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
    const {
      partCode,
      name,
      description,
      weightPerPiece,
      pouringWeight,
      alloyGrade,
      // The ordered processes this part's castings pass through
      route,
    } = body;

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

    const routeCheck = await validateRoute(route);
    if (!routeCheck.ok) {
      return NextResponse.json({ error: routeCheck.error }, { status: 400 });
    }

    const part = await prisma.part.create({
      data: {
        partCode,
        name,
        description: description || null,
        ...weights.value,
        ...(alloyGrade !== undefined ? { alloyGrade: String(alloyGrade) } : {}),
        isActive: true,
        routeSteps: { create: routeCheck.steps },
      },
      include: routeInclude,
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
    const {
      id,
      partCode,
      name,
      description,
      weightPerPiece,
      pouringWeight,
      isActive,
      alloyGrade,
      route,
    } = body;

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

    const routeCheck = await validateRoute(route);
    if (!routeCheck.ok) {
      return NextResponse.json({ error: routeCheck.error }, { status: 400 });
    }

    /*
     * The route is replaced, not patched.
     *
     * Deleting and recreating inside one transaction sidesteps the reordering
     * problem entirely: moving a step from position 3 to 1 by updating rows
     * would collide with the unique constraint halfway through, and every
     * order of updates has some case where it does. Wiping first cannot.
     *
     * Route steps carry no history of their own - the piece movements do -
     * so nothing is lost by recreating them.
     */
    const part = await prisma.$transaction(async (tx) => {
      if (route !== undefined) {
        await tx.partRouteStep.deleteMany({ where: { partId: id } });
      }
      return tx.part.update({
        where: { id },
        data: {
          partCode,
          name,
          description,
          ...weights.value,
          ...(alloyGrade !== undefined ? { alloyGrade: String(alloyGrade) } : {}),
          isActive: isActive ?? true,
          ...(route !== undefined
            ? { routeSteps: { create: routeCheck.steps } }
            : {}),
        },
        include: routeInclude,
      });
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
