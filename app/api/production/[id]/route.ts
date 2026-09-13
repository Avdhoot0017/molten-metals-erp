import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { formatWeight } from "@/lib/units";
import { canRead, canWrite, canAmendCompletedBatch } from "@/lib/permissions";
import {
  calculateDensityIndex,
  validateDensityPair,
} from "@/lib/density-index";
import { parseComposition } from "@/lib/composition";
import {
  materialType,
  gradeName,
  isIngotType,
  GRADE_NAMES,
  SCRAP_FORMS,
} from "@/lib/ingot";
import type { AluminumType } from "@/types";
import { Prisma } from "@prisma/client";

/**
 * Every stock movement one batch is responsible for, as a net weight per
 * material line.
 *
 * Amending a batch is then just the difference between the movements it USED
 * to be responsible for and the ones it is now - which handles a corrected
 * weight, a corrected grade, and both at once, without any special cases.
 */
function batchMovements(batch: {
  ingotGrade: string;
  aluminumUsedLM6: number;
  aluminumUsedLM9: number;
  aluminumUsedLM25: number;
  runnerRaiserScrapUsed: number;
  spillageScrapUsed: number;
  rejectedPartScrapUsed: number;
  runnerRaiserScrap: number;
  spillageScrap: number;
  rejectedPartScrap: number;
}): Map<AluminumType, number> {
  const moves = new Map<AluminumType, number>();
  const add = (type: AluminumType, amount: number) => {
    if (amount === 0) return;
    moves.set(type, (moves.get(type) ?? 0) + amount);
  };

  // Ingot charged leaves its grade's stock line
  const perGrade: Record<string, number> = {
    LM6: batch.aluminumUsedLM6,
    LM9: batch.aluminumUsedLM9,
    LM25: batch.aluminumUsedLM25,
  };
  for (const grade of GRADE_NAMES) {
    add(materialType("INGOT", grade), -(perGrade[grade] ?? 0));
  }

  // Scrap re-melted leaves, scrap generated arrives - both on the heat's grade
  const grade = gradeName(batch.ingotGrade as AluminumType);
  const used: Record<string, number> = {
    RUNNER_RAISER: batch.runnerRaiserScrapUsed,
    SPILLAGE: batch.spillageScrapUsed,
    REJECTED_PART: batch.rejectedPartScrapUsed,
  };
  const made: Record<string, number> = {
    RUNNER_RAISER: batch.runnerRaiserScrap,
    SPILLAGE: batch.spillageScrap,
    REJECTED_PART: batch.rejectedPartScrap,
  };
  for (const form of SCRAP_FORMS) {
    const type = materialType(form.form, grade);
    add(type, -(used[form.form] ?? 0));
    add(type, made[form.form] ?? 0);
  }

  return moves;
}

const recordInclude = {
  items: {
    include: {
      part: { select: { id: true, name: true, partCode: true, weightPerPiece: true } },
    },
  },
  furnace: { select: { id: true, name: true } },
  user: { select: { name: true } },
} satisfies Prisma.ProductionRecordInclude;

// GET - One production record
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/production/[id]">
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canRead(session, "production")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }

    const { id } = await ctx.params;
    const record = await prisma.productionRecord.findUnique({
      where: { id },
      include: recordInclude,
    });

    if (!record) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: record });
  } catch (error) {
    console.error("Error fetching production record:", error);
    return NextResponse.json(
      { error: "Failed to fetch production record" },
      { status: 500 }
    );
  }
}

/**
 * PATCH - the later stages of a batch.
 *
 * A heat is not one event. It is charged, assayed a few hours later, and only
 * counted once the castings come off the line, so the batch is filled in over
 * the same three moments:
 *
 *   stage "melt"     composition and density index  -> UPDATED
 *   stage "complete" parts, scrap generated, notes  -> COMPLETED
 *
 * A batch can go straight from PENDING to COMPLETED: the assay is optional,
 * and a shift that never took a sample should not be blocked from closing.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/production/[id]">
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canWrite(session, "production")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const { id } = await ctx.params;
    const body = await request.json();
    const { stage } = body;

    const record = await prisma.productionRecord.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!record) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
    // A completed batch has already moved stock, so amending one is a
    // correction rather than data entry - admins only.
    if (record.status === "COMPLETED" && !canAmendCompletedBatch(session)) {
      return NextResponse.json(
        { error: "Only an admin can change a batch once it is completed" },
        { status: 403 }
      );
    }

    if (stage === "amend") {
      if (!canAmendCompletedBatch(session)) {
        return NextResponse.json(
          { error: "Only an admin can amend a batch" },
          { status: 403 }
        );
      }
      return await amendBatch(id, record, body, session.id);
    }
    if (stage === "melt") {
      return await recordMeltQuality(id, body, record.status);
    }
    if (stage === "complete") {
      return await completeBatch(id, record, body, session.id);
    }

    return NextResponse.json(
      { error: 'Unknown stage - expected "melt", "complete" or "amend"' },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error updating production record:", error);
    return NextResponse.json(
      { error: "Failed to update production record" },
      { status: 500 }
    );
  }
}

/**
 * The charge half of a batch: which furnace, which alloy, what went in.
 * Shared with the create route's rules so an amendment cannot save something
 * the original form would have refused.
 */
async function parseCharge(body: Record<string, unknown>, currentFurnaceId: string | null) {
  const furnaceId = (body.furnaceId as string) || currentFurnaceId;
  if (!furnaceId) {
    return { error: NextResponse.json({ error: "Furnace is required" }, { status: 400 }) };
  }
  const furnace = await prisma.furnace.findUnique({ where: { id: furnaceId } });
  if (!furnace) {
    return { error: NextResponse.json({ error: "Furnace not found" }, { status: 404 }) };
  }

  const ingotCharge = [
    { grade: "LM6", amount: Number(body.aluminumUsedLM6) || 0 },
    { grade: "LM9", amount: Number(body.aluminumUsedLM9) || 0 },
    { grade: "LM25", amount: Number(body.aluminumUsedLM25) || 0 },
  ];
  for (const ingot of ingotCharge) {
    if (ingot.amount < 0) {
      return {
        error: NextResponse.json(
          { error: `${ingot.grade} used cannot be negative` },
          { status: 400 }
        ),
      };
    }
  }

  const aluminumUsedNum = ingotCharge.reduce((sum, i) => sum + i.amount, 0);

  // Taken from the caller when given, because a heat charged entirely with
  // re-melted scrap has no ingot to read a grade from
  const batchIngotType =
    typeof body.ingotGrade === "string" &&
    isIngotType(body.ingotGrade as AluminumType)
      ? (body.ingotGrade as AluminumType)
      : materialType(
          "INGOT",
          ingotCharge.reduce((best, i) => (i.amount > best.amount ? i : best))
            .grade
        );
  const batchGrade = gradeName(batchIngotType);

  const scrapUsed = [
    { form: "RUNNER_RAISER" as const, label: "Runner & Raiser", amount: Number(body.runnerRaiserScrapUsed) || 0 },
    { form: "SPILLAGE" as const, label: "Spillage", amount: Number(body.spillageScrapUsed) || 0 },
    { form: "REJECTED_PART" as const, label: "Rejected Part", amount: Number(body.rejectedPartScrapUsed) || 0 },
  ];
  for (const scrap of scrapUsed) {
    if (scrap.amount < 0) {
      return {
        error: NextResponse.json(
          { error: `${scrap.label} scrap used cannot be negative` },
          { status: 400 }
        ),
      };
    }
  }

  const totalScrapUsedNum = scrapUsed.reduce((sum, s) => sum + s.amount, 0);

  // Something has to go into the furnace, but it does not have to be fresh
  // ingot - a heat run entirely on re-melted scrap is ordinary foundry work.
  if (aluminumUsedNum + totalScrapUsedNum <= 0) {
    return {
      error: NextResponse.json(
        { error: "Enter the ingot or the scrap charged into this heat" },
        { status: 400 }
      ),
    };
  }

  return {
    furnaceId,
    ingotCharge,
    aluminumUsedNum,
    batchGrade,
    batchIngotType,
    scrapUsed,
    totalScrapUsedNum,
  };
}

/** The output half: castings counted and scrap booked. */
async function parseOutput(body: Record<string, unknown>) {
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return {
      error: NextResponse.json(
        { error: "At least one part is required" },
        { status: 400 }
      ),
    };
  }

  const normalised: Array<{
    partId: string;
    quantityProduced: number;
    goodParts: number;
    rejectedParts: number;
  }> = [];

  for (const item of items) {
    if (!item?.partId) {
      return { error: NextResponse.json({ error: "Every line needs a part" }, { status: 400 }) };
    }
    const qty = parseInt(item.quantityProduced);
    const good = parseInt(item.goodParts);
    if (!Number.isInteger(qty) || qty <= 0) {
      return {
        error: NextResponse.json(
          { error: "Quantity produced must be a whole number greater than 0" },
          { status: 400 }
        ),
      };
    }
    if (!Number.isInteger(good) || good < 0 || good > qty) {
      return {
        error: NextResponse.json(
          { error: "Good parts must be between 0 and the quantity produced" },
          { status: 400 }
        ),
      };
    }
    normalised.push({
      partId: item.partId,
      quantityProduced: qty,
      goodParts: good,
      rejectedParts: qty - good,
    });
  }

  const partIds = normalised.map((i) => i.partId);
  if (new Set(partIds).size !== partIds.length) {
    return {
      error: NextResponse.json(
        { error: "The same part is listed more than once" },
        { status: 400 }
      ),
    };
  }

  const parts = await prisma.part.findMany({ where: { id: { in: partIds } } });
  if (parts.length !== partIds.length) {
    return { error: NextResponse.json({ error: "Part not found" }, { status: 404 }) };
  }
  const partById = new Map(parts.map((p) => [p.id, p]));

  const runnerRaiserScrap = Number(body.runnerRaiserScrap) || 0;
  const spillageScrap = Number(body.spillageScrap) || 0;
  const rejectedPartScrap = Number(body.rejectedPartScrap) || 0;
  for (const [label, value] of [
    ["Runner & raiser", runnerRaiserScrap],
    ["Spillage", spillageScrap],
    ["Rejected part", rejectedPartScrap],
  ] as const) {
    if (value < 0) {
      return {
        error: NextResponse.json(
          { error: `${label} scrap cannot be negative` },
          { status: 400 }
        ),
      };
    }
  }

  return {
    items: normalised,
    quantityProduced: normalised.reduce((s, i) => s + i.quantityProduced, 0),
    goodParts: normalised.reduce((s, i) => s + i.goodParts, 0),
    rejectedParts: normalised.reduce((s, i) => s + i.rejectedParts, 0),
    runnerRaiserScrap,
    spillageScrap,
    rejectedPartScrap,
    totalScrap: runnerRaiserScrap + spillageScrap + rejectedPartScrap,
    expectedOutput: normalised.reduce(
      (sum, i) => sum + i.goodParts * (partById.get(i.partId)?.weightPerPiece ?? 0),
      0
    ),
  };
}

/** The assay half: composition and density index, both optional. */
function parseMelt(body: Record<string, unknown>) {
  const { densityAtmospheric, densityVacuum, composition } = body;

  const hasA =
    densityAtmospheric !== undefined &&
    densityAtmospheric !== null &&
    densityAtmospheric !== "";
  const hasB =
    densityVacuum !== undefined && densityVacuum !== null && densityVacuum !== "";

  if (hasA !== hasB) {
    return {
      error: NextResponse.json(
        {
          error:
            "Enter both the atmospheric and vacuum density, or leave both blank",
        },
        { status: 400 }
      ),
    };
  }

  let densityA: number | null = null;
  let densityB: number | null = null;
  let densityIndex: number | null = null;

  if (hasA && hasB) {
    densityA = parseFloat(String(densityAtmospheric));
    densityB = parseFloat(String(densityVacuum));
    const densityError = validateDensityPair(densityA, densityB);
    if (densityError) {
      return { error: NextResponse.json({ error: densityError }, { status: 400 }) };
    }
    densityIndex = calculateDensityIndex(densityA, densityB);
  }

  const parsed = parseComposition(composition);
  if (parsed.entries === null) {
    return { error: NextResponse.json({ error: parsed.error }, { status: 400 }) };
  }

  return { densityA, densityB, densityIndex, composition: parsed.entries };
}

/**
 * Admin correction of a batch, in one pass.
 *
 * Everything the three stages record is editable here, because a correction is
 * not a stage - it is someone who can see the whole batch fixing whichever
 * part of it is wrong. Stock is settled by comparing the movements the batch
 * used to be responsible for against the ones it is now, so a changed weight,
 * a changed grade, or both at once all come out right without special cases.
 */
async function amendBatch(
  id: string,
  record: Prisma.ProductionRecordGetPayload<{ include: { items: true } }>,
  body: Record<string, unknown>,
  userId: string
) {
  const charge = await parseCharge(body, record.furnaceId);
  if ("error" in charge) return charge.error;

  const output = await parseOutput(body);
  if ("error" in output) return output.error;

  const melt = parseMelt(body);
  if ("error" in melt) return melt.error;

  const next = {
    ingotGrade: charge.batchIngotType,
    aluminumUsedLM6: charge.ingotCharge[0].amount,
    aluminumUsedLM9: charge.ingotCharge[1].amount,
    aluminumUsedLM25: charge.ingotCharge[2].amount,
    runnerRaiserScrapUsed: charge.scrapUsed[0].amount,
    spillageScrapUsed: charge.scrapUsed[1].amount,
    rejectedPartScrapUsed: charge.scrapUsed[2].amount,
    runnerRaiserScrap: output.runnerRaiserScrap,
    spillageScrap: output.spillageScrap,
    rejectedPartScrap: output.rejectedPartScrap,
  };

  // What changes, line by line: the new movements minus the old ones
  const before = batchMovements(record);
  const after = batchMovements(next);
  const deltas = new Map<AluminumType, number>();
  for (const type of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(type) ?? 0) - (before.get(type) ?? 0);
    if (delta !== 0) deltas.set(type, delta);
  }

  // Refuse before writing anything if a correction would leave a line short -
  // that metal may already have gone into another heat
  for (const [type, delta] of deltas) {
    if (delta >= 0) continue;
    const stock = await prisma.inventory.findUnique({ where: { type } });
    const available = stock?.quantity ?? 0;
    if (available + delta < 0) {
      return NextResponse.json(
        {
          error: `That correction needs ${formatWeight(-delta)} of ${type}, but only ${formatWeight(available)} is in stock.`,
        },
        { status: 400 }
      );
    }
  }

  const meltInput = charge.aluminumUsedNum + charge.totalScrapUsedNum;
  const efficiency = meltInput > 0 ? (output.expectedOutput / meltInput) * 100 : 0;


  const result = await prisma.$transaction(async (tx) => {
    await tx.productionItem.deleteMany({ where: { productionRecordId: id } });

    const updated = await tx.productionRecord.update({
      where: { id },
      data: {
        ...next,
        ...(charge.furnaceId ? { furnaceId: charge.furnaceId } : {}),
        aluminumUsed: charge.aluminumUsedNum,
        totalScrapUsed: charge.totalScrapUsedNum,
        items: { create: output.items },
        quantityProduced: output.quantityProduced,
        goodParts: output.goodParts,
        rejectedParts: output.rejectedParts,
        totalScrap: output.totalScrap,
        efficiency,
        densityAtmospheric: melt.densityA,
        densityVacuum: melt.densityB,
        densityIndex: melt.densityIndex,
        composition:
          melt.composition.length > 0
            ? (melt.composition as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        ...(typeof body.notes === "string" ? { notes: body.notes || null } : {}),
      },
      include: recordInclude,
    });

    for (const [type, delta] of deltas) {
      const stock = await tx.inventory.findUnique({ where: { type } });
      const prevQty = stock?.quantity ?? 0;

      await tx.inventory.upsert({
        where: { type },
        update: { quantity: { increment: delta }, lastUpdated: new Date() },
        create: { type, quantity: Math.max(0, delta) },
      });

      await tx.inventoryLog.create({
        data: {
          type,
          action: "ADJUST",
          quantity: delta,
          previousQty: prevQty,
          newQty: prevQty + delta,
          reference: "Production",
          referenceId: id,
          notes: `Corrected on production batch ${updated.batchNumber}`,
          createdBy: userId,
        },
      });
    }

    return updated;
  });

  return NextResponse.json({ success: true, data: result });
}

/** Stage 2: what the assay said. Moves a PENDING batch to UPDATED. */
async function recordMeltQuality(
  id: string,
  body: Record<string, unknown>,
  currentStatus: "PENDING" | "UPDATED" | "COMPLETED"
) {
  const { densityAtmospheric, densityVacuum, composition } = body;

  // Density Index is optional, but both samples are needed to compute it
  const hasDensityA =
    densityAtmospheric !== undefined &&
    densityAtmospheric !== null &&
    densityAtmospheric !== "";
  const hasDensityB =
    densityVacuum !== undefined && densityVacuum !== null && densityVacuum !== "";

  if (hasDensityA !== hasDensityB) {
    return NextResponse.json(
      {
        error:
          "Enter both the atmospheric and vacuum density, or leave both blank",
      },
      { status: 400 }
    );
  }

  let densityANum: number | null = null;
  let densityBNum: number | null = null;
  let densityIndexNum: number | null = null;

  if (hasDensityA && hasDensityB) {
    densityANum = parseFloat(String(densityAtmospheric));
    densityBNum = parseFloat(String(densityVacuum));

    const densityError = validateDensityPair(densityANum, densityBNum);
    if (densityError) {
      return NextResponse.json({ error: densityError }, { status: 400 });
    }
    densityIndexNum = calculateDensityIndex(densityANum, densityBNum);
  }

  const compositionResult = parseComposition(composition);
  if (compositionResult.entries === null) {
    return NextResponse.json(
      { error: compositionResult.error },
      { status: 400 }
    );
  }
  const compositionEntries = compositionResult.entries;

  const updated = await prisma.productionRecord.update({
    where: { id },
    data: {
      // Correcting the assay on a closed batch must not reopen it - the
      // castings were still counted and the scrap still booked.
      status: currentStatus === "COMPLETED" ? "COMPLETED" : "UPDATED",
      densityAtmospheric: densityANum,
      densityVacuum: densityBNum,
      densityIndex: densityIndexNum,
      composition:
        compositionEntries.length > 0
          ? (compositionEntries as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
    },
    include: recordInclude,
  });

  return NextResponse.json({ success: true, data: updated });
}

/**
 * Stage 3: what came out. Counts the castings, books the scrap generated and
 * closes the batch.
 *
 * Efficiency can only be worked out here, because it compares the metal
 * charged (known at stage 1) against the weight of good castings (known now).
 */
async function completeBatch(
  id: string,
  record: {
    aluminumUsed: number;
    totalScrapUsed: number;
    ingotGrade: string;
    status: "PENDING" | "UPDATED" | "COMPLETED";
    runnerRaiserScrap: number;
    spillageScrap: number;
    rejectedPartScrap: number;
    notes: string | null;
  },
  body: Record<string, unknown>,
  userId: string
) {
  const {
    items,
    runnerRaiserScrap,
    spillageScrap,
    rejectedPartScrap,
    notes,
  } = body;

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "At least one part is required to complete a batch" },
      { status: 400 }
    );
  }

  // Validate and normalise each line before touching the database
  const normalisedItems: Array<{
    partId: string;
    quantityProduced: number;
    goodParts: number;
    rejectedParts: number;
  }> = [];

  for (const item of items) {
    if (!item?.partId) {
      return NextResponse.json(
        { error: "Every line needs a part" },
        { status: 400 }
      );
    }

    const qty = parseInt(item.quantityProduced);
    const good = parseInt(item.goodParts);

    if (!Number.isInteger(qty) || qty <= 0) {
      return NextResponse.json(
        { error: "Quantity produced must be a whole number greater than 0" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(good) || good < 0 || good > qty) {
      return NextResponse.json(
        { error: "Good parts must be between 0 and the quantity produced" },
        { status: 400 }
      );
    }

    normalisedItems.push({
      partId: item.partId,
      quantityProduced: qty,
      goodParts: good,
      rejectedParts: qty - good,
    });
  }

  // A part may only appear once per batch
  const partIds = normalisedItems.map((i) => i.partId);
  if (new Set(partIds).size !== partIds.length) {
    return NextResponse.json(
      { error: "The same part is listed more than once" },
      { status: 400 }
    );
  }

  const parts = await prisma.part.findMany({ where: { id: { in: partIds } } });
  if (parts.length !== partIds.length) {
    return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }
  const partById = new Map(parts.map((p) => [p.id, p]));

  const runnerRaiserScrapNum = parseFloat(String(runnerRaiserScrap)) || 0;
  const spillageScrapNum = parseFloat(String(spillageScrap)) || 0;
  const rejectedPartScrapNum = parseFloat(String(rejectedPartScrap)) || 0;

  for (const [label, value] of [
    ["Runner & raiser", runnerRaiserScrapNum],
    ["Spillage", spillageScrapNum],
    ["Rejected part", rejectedPartScrapNum],
  ] as const) {
    if (value < 0) {
      return NextResponse.json(
        { error: `${label} scrap cannot be negative` },
        { status: 400 }
      );
    }
  }

  // Batch totals rolled up from the lines
  const quantityProducedNum = normalisedItems.reduce((s, i) => s + i.quantityProduced, 0);
  const goodPartsNum = normalisedItems.reduce((s, i) => s + i.goodParts, 0);
  const rejectedPartsNum = normalisedItems.reduce((s, i) => s + i.rejectedParts, 0);

  const totalScrap =
    runnerRaiserScrapNum + spillageScrapNum + rejectedPartScrapNum;

  // Expected output weight is the sum of each line's good parts x its weight
  const expectedOutput = normalisedItems.reduce(
    (sum, i) => sum + i.goodParts * (partById.get(i.partId)?.weightPerPiece ?? 0),
    0
  );
  // Everything charged into the furnace counts as input, so the scrap that was
  // re-melted at stage 1 is included alongside the fresh ingot.
  const meltInput = record.aluminumUsed + record.totalScrapUsed;
  const efficiency = meltInput > 0 ? (expectedOutput / meltInput) * 100 : 0;


  // Scrap takes the grade of the heat it came off
  const batchGrade = gradeName(record.ingotGrade as never);

  // A correction that lowers the scrap figure takes metal back out of stock,
  // and that stock may already have been re-melted into another heat. Check
  // before writing anything rather than leaving a line negative.
  if (record.status === "COMPLETED") {
    const reductions = [
      { form: "RUNNER_RAISER" as const, was: record.runnerRaiserScrap, now: runnerRaiserScrapNum },
      { form: "SPILLAGE" as const, was: record.spillageScrap, now: spillageScrapNum },
      { form: "REJECTED_PART" as const, was: record.rejectedPartScrap, now: rejectedPartScrapNum },
    ];
    for (const r of reductions) {
      const delta = r.now - r.was;
      if (delta >= 0) continue;
      const type = materialType(r.form, batchGrade);
      const stock = await prisma.inventory.findUnique({ where: { type } });
      const available = stock?.quantity ?? 0;
      if (available + delta < 0) {
        return NextResponse.json(
          {
            error: `Lowering that scrap figure would take ${type} below zero - only ${available} g is in stock and some has already been used.`,
          },
          { status: 400 }
        );
      }
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Replace the lines outright: completing a batch is the first time parts
    // are recorded, and re-running it should not double them up.
    await tx.productionItem.deleteMany({ where: { productionRecordId: id } });

    const updated = await tx.productionRecord.update({
      where: { id },
      data: {
        status: "COMPLETED",
        items: { create: normalisedItems },
        quantityProduced: quantityProducedNum,
        goodParts: goodPartsNum,
        rejectedParts: rejectedPartsNum,
        runnerRaiserScrap: runnerRaiserScrapNum,
        spillageScrap: spillageScrapNum,
        rejectedPartScrap: rejectedPartScrapNum,
        totalScrap,
        efficiency,
        ...(typeof notes === "string" ? { notes: notes || null } : {}),
      },
      include: recordInclude,
    });

    // Book the scrap this batch generated, onto this grade's stock lines.
    //
    // An amendment moves only the DIFFERENCE from what was booked before.
    // Re-crediting the full figure would count the same scrap twice, and the
    // amount can go down as well as up, so a correction may remove metal.
    const wasCompleted = record.status === "COMPLETED";
    const scrapGenerated = [
      {
        type: materialType("RUNNER_RAISER", batchGrade),
        amount: runnerRaiserScrapNum,
        already: wasCompleted ? record.runnerRaiserScrap : 0,
      },
      {
        type: materialType("SPILLAGE", batchGrade),
        amount: spillageScrapNum,
        already: wasCompleted ? record.spillageScrap : 0,
      },
      {
        type: materialType("REJECTED_PART", batchGrade),
        amount: rejectedPartScrapNum,
        already: wasCompleted ? record.rejectedPartScrap : 0,
      },
    ];

    for (const scrap of scrapGenerated) {
      const delta = scrap.amount - scrap.already;
      if (delta === 0) continue;

      const stock = await tx.inventory.findUnique({ where: { type: scrap.type } });
      const prevQty = stock?.quantity || 0;

      await tx.inventory.upsert({
        where: { type: scrap.type },
        update: { quantity: { increment: delta }, lastUpdated: new Date() },
        create: { type: scrap.type, quantity: Math.max(0, delta) },
      });

      await tx.inventoryLog.create({
        data: {
          type: scrap.type,
          action: wasCompleted ? "ADJUST" : "ADD",
          quantity: delta,
          previousQty: prevQty,
          newQty: prevQty + delta,
          reference: "Production",
          referenceId: id,
          notes: wasCompleted
            ? `Corrected on production batch ${updated.batchNumber} (was ${scrap.already} g, now ${scrap.amount} g)`
            : `Generated from production batch ${updated.batchNumber}`,
          createdBy: userId,
        },
      });
    }

    return updated;
  });

  return NextResponse.json({ success: true, data: result });
}

/**
 * DELETE - remove a batch and put back the metal it moved.
 *
 * Admin only, for the same reason amending is: this reverses stock movements
 * that have already been booked, which is a correction rather than routine
 * work.
 *
 * The batch's original inventory log entries are LEFT IN PLACE and reversing
 * entries are written alongside them. Deleting them would make the stock
 * figures unexplainable - the metal would move with nothing in the history
 * saying why. The reversal notes name the batch, so the pair reads as what it
 * is: booked, then undone.
 */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/production/[id]">
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canAmendCompletedBatch(session)) {
      return NextResponse.json(
        { error: "Only an admin can delete a production batch" },
        { status: 403 }
      );
    }

    const { id } = await ctx.params;
    const record = await prisma.productionRecord.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!record) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Undo exactly what this batch did: the reverse of its own movements
    const moves = batchMovements(record);
    const reversals = new Map<AluminumType, number>();
    for (const [type, amount] of moves) {
      if (amount !== 0) reversals.set(type, -amount);
    }

    // Metal this batch generated may already have gone into another heat, so
    // taking it back out could leave a line short. Checked before anything is
    // written rather than failing halfway.
    for (const [type, delta] of reversals) {
      if (delta >= 0) continue;
      const stock = await prisma.inventory.findUnique({ where: { type } });
      const available = stock?.quantity ?? 0;
      if (available + delta < 0) {
        return NextResponse.json(
          {
            error: `Deleting this batch would take ${type} below zero - it produced ${formatWeight(-delta)} but only ${formatWeight(available)} is left, so some has already been used.`,
          },
          { status: 400 }
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const [type, delta] of reversals) {
        const stock = await tx.inventory.findUnique({ where: { type } });
        const prevQty = stock?.quantity ?? 0;

        await tx.inventory.upsert({
          where: { type },
          update: { quantity: { increment: delta }, lastUpdated: new Date() },
          create: { type, quantity: Math.max(0, delta) },
        });

        await tx.inventoryLog.create({
          data: {
            type,
            action: "ADJUST",
            quantity: delta,
            previousQty: prevQty,
            newQty: prevQty + delta,
            reference: "Production",
            referenceId: id,
            notes: `Reversed - production batch ${record.batchNumber} was deleted`,
            createdBy: session.id,
          },
        });
      }

      // The line items go with it; the log entries above deliberately do not
      await tx.productionItem.deleteMany({ where: { productionRecordId: id } });
      await tx.productionRecord.delete({ where: { id } });
    });

    return NextResponse.json({
      success: true,
      message: `Batch ${record.batchNumber} deleted and its metal returned to stock`,
    });
  } catch (error) {
    console.error("Error deleting production record:", error);
    return NextResponse.json(
      { error: "Failed to delete production record" },
      { status: 500 }
    );
  }
}
