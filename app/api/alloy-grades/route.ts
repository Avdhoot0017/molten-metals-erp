/**
 * The alloy master: which grades this foundry runs.
 *
 * Readable by anyone signed in, because it is reference data every screen
 * needs - stock lines, part specs, the charge form, purchase orders. Writing
 * is Settings work, which is the admin's alone.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { gradeNameProblem, normaliseGradeName, materialType, MATERIAL_FORMS } from "@/lib/ingot";
import { allGrades, ensureStockLines, gradeSelect } from "@/lib/grades";
import { Prisma } from "@prisma/client";

// GET - every grade, retired ones included: history still names them
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const activeOnly = new URL(request.url).searchParams.get("activeOnly") === "true";
    const grades = await allGrades();
    return NextResponse.json({
      success: true,
      data: activeOnly ? grades.filter((g) => g.isActive) : grades,
    });
  } catch (error) {
    console.error("Error fetching alloy grades:", error);
    return NextResponse.json({ error: "Failed to fetch alloy grades" }, { status: 500 });
  }
}

/** Shared by POST and PUT: the editable fields, cleaned up. */
function readBody(body: Record<string, unknown>) {
  return {
    description:
      typeof body.description === "string" ? body.description.trim() || null : undefined,
    colorHex:
      typeof body.colorHex === "string"
        ? body.colorHex.trim().toUpperCase() || null
        : undefined,
    sortOrder: Number.isFinite(Number(body.sortOrder))
      ? Math.trunc(Number(body.sortOrder))
      : undefined,
    canBePurchased:
      typeof body.canBePurchased === "boolean" ? body.canBePurchased : undefined,
    isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
    compositionSpec:
      body.compositionSpec === undefined
        ? undefined
        : (body.compositionSpec as Prisma.InputJsonValue | null),
  };
}

// POST - add a grade, and its four stock lines with it
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canWrite(session, "settings")) {
      return NextResponse.json(
        { error: "Only an admin can change the alloy list" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const problem = gradeNameProblem(String(body.name ?? ""));
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
    }
    const name = normaliseGradeName(String(body.name));
    const fields = readBody(body);

    const grade = await prisma.$transaction(async (tx) => {
      const created = await tx.alloyGrade.create({
        data: {
          name,
          description: fields.description ?? null,
          colorHex: fields.colorHex ?? null,
          sortOrder: fields.sortOrder ?? 99,
          canBePurchased: fields.canBePurchased ?? true,
          ...(fields.compositionSpec !== undefined && fields.compositionSpec !== null
            ? { compositionSpec: fields.compositionSpec }
            : {}),
        },
        select: gradeSelect,
      });
      await ensureStockLines(created, tx);
      return created;
    });

    return NextResponse.json({ success: true, data: grade }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "That alloy is already on the list" }, { status: 409 });
    }
    console.error("Error creating alloy grade:", error);
    return NextResponse.json({ error: "Failed to add the alloy" }, { status: 500 });
  }
}

// PUT - edit a grade, renaming included
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canWrite(session, "settings")) {
      return NextResponse.json(
        { error: "Only an admin can change the alloy list" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const id = String(body.id ?? "");
    if (!id) {
      return NextResponse.json({ error: "Which alloy?" }, { status: 400 });
    }
    const existing = await prisma.alloyGrade.findUnique({ where: { id }, select: gradeSelect });
    if (!existing) {
      return NextResponse.json({ error: "That alloy is not on the list" }, { status: 404 });
    }

    let name = existing.name;
    if (body.name !== undefined) {
      const problem = gradeNameProblem(String(body.name));
      if (problem) {
        return NextResponse.json({ error: problem }, { status: 400 });
      }
      name = normaliseGradeName(String(body.name));
    }
    const fields = readBody(body);

    const grade = await prisma.$transaction(async (tx) => {
      const updated = await tx.alloyGrade.update({
        where: { id },
        data: {
          name,
          ...(fields.description !== undefined ? { description: fields.description } : {}),
          ...(fields.colorHex !== undefined ? { colorHex: fields.colorHex } : {}),
          ...(fields.sortOrder !== undefined ? { sortOrder: fields.sortOrder } : {}),
          ...(fields.canBePurchased !== undefined
            ? { canBePurchased: fields.canBePurchased }
            : {}),
          ...(fields.isActive !== undefined ? { isActive: fields.isActive } : {}),
          ...(fields.compositionSpec !== undefined
            ? {
                compositionSpec:
                  fields.compositionSpec === null
                    ? Prisma.DbNull
                    : fields.compositionSpec,
              }
            : {}),
        },
        select: gradeSelect,
      });

      /*
       * A rename carries the composed names with it.
       *
       * Stock and history are keyed by id, so nothing would break if these
       * were left behind - but they are what a person reads in the inventory
       * log, and "SPILLAGE_LM4O" after an admin fixed a typo would be a
       * puzzle nobody can solve. Quantities are never touched.
       */
      if (name !== existing.name) {
        for (const form of MATERIAL_FORMS) {
          const from = materialType(form.form, existing.name);
          const to = materialType(form.form, name);
          await tx.inventory.updateMany({ where: { type: from }, data: { type: to } });
          await tx.inventoryLog.updateMany({ where: { type: from }, data: { type: to } });
        }
        await tx.productionRecord.updateMany({
          where: { ingotGrade: materialType("INGOT", existing.name) },
          data: { ingotGrade: materialType("INGOT", name) },
        });
        // Parts name their alloy in plain text
        await tx.part.updateMany({
          where: { alloyGrade: existing.name },
          data: { alloyGrade: name },
        });
      }

      await ensureStockLines(updated, tx);
      return updated;
    });

    return NextResponse.json({ success: true, data: grade });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Another alloy already has that name" }, { status: 409 });
    }
    console.error("Error updating alloy grade:", error);
    return NextResponse.json({ error: "Failed to save the alloy" }, { status: 500 });
  }
}

/**
 * DELETE - retires a grade, and only truly deletes one nothing has used.
 *
 * Stock, batches and parts are keyed to the id, so removing a grade they
 * reference would take their own history with them. A grade that has been
 * used is therefore deactivated: it stops being offered, and everything
 * recorded against it still reads. A grade added by mistake five minutes ago,
 * with nothing against it and no stock, is removed outright - otherwise a
 * typo would sit in the list for ever.
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canWrite(session, "settings")) {
      return NextResponse.json(
        { error: "Only an admin can change the alloy list" },
        { status: 403 }
      );
    }

    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Which alloy?" }, { status: 400 });
    }
    const grade = await prisma.alloyGrade.findUnique({ where: { id }, select: gradeSelect });
    if (!grade) {
      return NextResponse.json({ error: "That alloy is not on the list" }, { status: 404 });
    }

    const [stock, charges, heats, parts, logs] = await Promise.all([
      prisma.inventory.aggregate({
        where: { gradeId: id },
        _sum: { quantity: true },
      }),
      prisma.productionCharge.count({ where: { gradeId: id } }),
      prisma.productionRecord.count({ where: { resultGradeId: id } }),
      prisma.part.count({ where: { alloyGrade: grade.name } }),
      prisma.inventoryLog.count({ where: { gradeId: id } }),
    ]);

    const held = stock._sum.quantity ?? 0;
    const used = charges > 0 || heats > 0 || parts > 0 || logs > 0 || held > 0;

    if (!used) {
      await prisma.$transaction(async (tx) => {
        await tx.inventory.deleteMany({ where: { gradeId: id } });
        await tx.alloyGrade.delete({ where: { id } });
      });
      return NextResponse.json({
        success: true,
        removed: true,
        message: `${grade.name} removed`,
      });
    }

    await prisma.alloyGrade.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({
      success: true,
      removed: false,
      message: `${grade.name} is in use, so it has been retired rather than deleted - its stock and history still read, and it is no longer offered on new entries.`,
    });
  } catch (error) {
    console.error("Error removing alloy grade:", error);
    return NextResponse.json({ error: "Failed to remove the alloy" }, { status: 500 });
  }
}
