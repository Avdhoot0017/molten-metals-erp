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
import { castingOutput, chargeOf, suggestedHeel } from "@/lib/production";
import {
  productionMoves,
  stageDelta,
  applyStageMoves,
  describeStage,
  reverseMoves,
  type RouteStepRef,
} from "@/lib/pieces";

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

/**
 * Thrown when a piece movement would leave a stage negative.
 *
 * An exception rather than a return value because the check happens inside the
 * transaction, where returning would commit everything up to that point. This
 * unwinds the lot.
 */
class PieceMoveRefused extends Error {}

/** The ordered route of each part, keyed by part id. */
async function routesFor(partIds: string[]): Promise<Map<string, RouteStepRef[]>> {
  const steps = await prisma.partRouteStep.findMany({
    where: { partId: { in: partIds } },
    orderBy: { sequence: "asc" },
    select: { id: true, partId: true, sequence: true, activityTypeId: true },
  });
  const byPart = new Map<string, RouteStepRef[]>();
  for (const step of steps) {
    const list = byPart.get(step.partId) ?? [];
    list.push({ id: step.id, sequence: step.sequence, activityTypeId: step.activityTypeId });
    byPart.set(step.partId, list);
  }
  return byPart;
}

/** Process names for the steps in these routes, for error messages. */
async function processNamesFor(
  routes: Map<string, RouteStepRef[]>
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const route of routes.values()) {
    for (const step of route) ids.add(step.activityTypeId);
  }
  if (ids.size === 0) return new Map();
  const types = await prisma.activityType.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true },
  });
  return new Map(types.map((t) => [t.id, t.name]));
}

const recordInclude = {
  items: {
    include: {
      part: {
        select: {
          id: true,
          name: true,
          partCode: true,
          weightPerPiece: true,
          pouringWeight: true,
        },
      },
    },
  },
  furnace: { select: { id: true, name: true } },
  operator: { select: { id: true, name: true, employeeCode: true } },
  user: { select: { name: true } },
  // Where this heat's metal came from, and where its leftover went. Both ends
  // are shown on the batch so a heel can be traced without another query.
  carriedFrom: { select: { id: true, batchNumber: true } },
  carriedTo: { select: { id: true, batchNumber: true } },
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
      // carriedTo says whether the next heat has already melted this batch's
      // leftover metal, which decides whether that figure may still change
      include: { items: true, carriedTo: { select: { batchNumber: true } } },
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
    if (stage === "parts") {
      return await completeBatch(id, record, body, session.id, { closing: false });
    }
    if (stage === "complete") {
      return await completeBatch(id, record, body, session.id, { closing: true });
    }

    return NextResponse.json(
      { error: 'Unknown stage - expected "melt", "parts", "complete" or "amend"' },
      { status: 400 }
    );
  } catch (error) {
    // A refused piece movement is the operator being told something is wrong
    // with the figures, not a server fault - it must not read as one
    if (error instanceof PieceMoveRefused) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
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
  record: Prisma.ProductionRecordGetPayload<{ include: { items: true; carriedTo: { select: { batchNumber: true } } } }>,
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
/**
 * The castings and the scrap, in one function because they are one sum.
 *
 * A heat is written up in two sittings: the castings are counted as they come
 * off, and the scrap is weighed once it has been collected. Both figures are
 * checked against the same charge, so splitting them into two functions would
 * mean two copies of the same arithmetic drifting apart.
 *
 * `closing: false` records the castings and what is left in the furnace, and
 * leaves the batch open. `closing: true` books the scrap and closes it.
 */
async function completeBatch(
  id: string,
  record: {
    aluminumUsed: number;
    totalScrapUsed: number;
    carriedInWeight: number;
    metalRemaining: number | null;
    carriedTo: { batchNumber: string } | null;
    /** What this batch already put on the floor, if it is being amended. */
    items: Array<{ partId: string; quantityProduced: number; goodParts: number }>;
    ingotGrade: string;
    status: "PENDING" | "UPDATED" | "COMPLETED";
    runnerRaiserScrap: number;
    spillageScrap: number;
    rejectedPartScrap: number;
    notes: string | null;
  },
  body: Record<string, unknown>,
  userId: string,
  { closing }: { closing: boolean }
) {
  const {
    items,
    runnerRaiserScrap,
    spillageScrap,
    rejectedPartScrap,
    metalRemaining,
    notes,
  } = body;

  /*
   * The castings, from the request or from what was recorded earlier.
   *
   * Closing a batch asks only for the scrap - the castings were counted at the
   * previous stage and are not on screen. Re-sending them would mean retyping
   * figures the batch already holds.
   */
  const sentItems = Array.isArray(items) && items.length > 0 ? items : null;
  const sourceItems =
    sentItems ??
    record.items.map((i) => ({
      partId: i.partId,
      quantityProduced: i.quantityProduced,
      goodParts: i.goodParts,
    }));

  if (sourceItems.length === 0) {
    return NextResponse.json(
      {
        error: closing
          ? "Count the castings before closing this batch"
          : "At least one part is required",
      },
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

  for (const item of sourceItems) {
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

  /*
   * Scrap is only weighed at the closing stage. Recording the castings must
   * leave whatever scrap the batch already has alone - reading a missing field
   * as 0 would wipe it.
   */
  const keep = (sent: unknown, current: number) =>
    closing || sent !== undefined ? parseFloat(String(sent)) || 0 : current;
  const runnerRaiserScrapNum = keep(runnerRaiserScrap, record.runnerRaiserScrap);
  const spillageScrapNum = keep(spillageScrap, record.spillageScrap);
  const rejectedPartScrapNum = keep(rejectedPartScrap, record.rejectedPartScrap);

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

  // What the castings account for, from the parts' own weights. Used to work
  // out what is left in the furnace once they have been poured.
  const output = castingOutput(
    normalisedItems.map((i) => ({
      quantityProduced: i.quantityProduced,
      goodParts: i.goodParts,
      part: {
        weightPerPiece: partById.get(i.partId)?.weightPerPiece ?? 0,
        pouringWeight: partById.get(i.partId)?.pouringWeight ?? null,
      },
    }))
  );

  const charge = chargeOf(record);

  /**
   * Metal still in the furnace when this batch closed.
   *
   * Everything charged less everything poured, unless the operator says
   * otherwise - they can see the furnace and the estimate cannot account for
   * dross. Either way it moves no stock: this metal left inventory when the
   * batch was charged and has not come back.
   */
  const heelGiven =
    metalRemaining !== undefined &&
    metalRemaining !== null &&
    metalRemaining !== "";
  const heel = heelGiven
    ? parseFloat(String(metalRemaining))
    // Not on screen when closing, so what was recorded with the castings
    // stands; a batch that never had one falls back to the calculation
    : record.metalRemaining ?? suggestedHeel(charge, output.poured);

  if (!Number.isFinite(heel) || heel < 0) {
    return NextResponse.json(
      { error: "Metal left in the furnace cannot be negative" },
      { status: 400 }
    );
  }
  if (heel > charge) {
    return NextResponse.json(
      {
        error: `More metal left in the furnace (${formatWeight(heel)}) than went into it (${formatWeight(charge)})`,
      },
      { status: 400 }
    );
  }
  /*
   * The LEFTOVER is what this defends, not the casting count.
   *
   * Parts that need more metal than went in are usually a miscount, but not
   * always - metal gets added from another furnace, a drawing weight is wrong -
   * and the operator is the one who knows. The form asks them for a note and
   * saves what they say.
   *
   * Metal still in the furnace is different: the next heat is charged with it
   * as real metal. Claiming a leftover that the castings have already used up
   * would hand the next batch kilos that do not exist, so that is refused
   * whoever says it. Checking the pair also catches an amendment that leaves
   * the leftover alone and doubles the castings underneath it.
   */
  if (heel > 0 && output.poured + heel > charge + 1) {
    const claimed = record.carriedTo
      ? ` Batch ${record.carriedTo.batchNumber} is already using that leftover, so correct this batch or amend that one first.`
      : "";
    return NextResponse.json(
      {
        error: `The parts use ${formatWeight(output.poured)} of metal and ${formatWeight(heel)} is said to be left in the furnace, but only ${formatWeight(charge)} went in. Lower one of them.${claimed}`,
      },
      { status: 400 }
    );
  }

  // Changing the leftover after the next heat has already melted it would
  // rewrite that batch's charge behind its back
  if (
    record.carriedTo &&
    record.metalRemaining !== null &&
    heel !== record.metalRemaining
  ) {
    return NextResponse.json(
      {
        error: `Batch ${record.carriedTo.batchNumber} has already melted this leftover metal, so it cannot be changed. Amend that batch first.`,
      },
      { status: 400 }
    );
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
  // Everything charged into the furnace counts as input: the fresh ingot, the
  // scrap re-melted at stage 1, and any metal carried over from the previous
  // heat. Metal left behind was never available to this batch's castings, so it
  // comes off the input rather than counting against it.
  const meltInput = charge - heel;
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

  /*
   * Good castings become pieces on the shop floor, waiting at the first
   * station of each part's route.
   *
   * Rejected castings do not: they were scrapped at the furnace and booked as
   * metal, so they never became pieces. A part with no route has nothing
   * defined to do to it, so its castings go straight to finished stock.
   *
   * On an amendment only the difference moves, so correcting 10 good to 8
   * takes 2 back out - and is refused if a station has already worked them.
   */
  const routes = await routesFor(normalisedItems.map((i) => i.partId));
  const processNames = await processNamesFor(routes);
  /*
   * What this batch has already put on the floor.
   *
   * Keyed on whether castings were recorded, not on whether the batch is
   * closed: they are now counted at their own stage, so an open batch can
   * already have pieces standing at a station. Reading this as "nothing"
   * would book the same castings a second time when the batch is closed.
   */
  const pieceBefore =
    record.items.length > 0
      ? productionMoves(
          record.items.map((i) => ({ partId: i.partId, goodParts: i.goodParts })),
          routes
        )
      : new Map();
  const pieceAfter = productionMoves(normalisedItems, routes);
  const pieceDeltas = stageDelta(pieceBefore, pieceAfter);

  const result = await prisma.$transaction(async (tx) => {
    // Replace the lines outright: completing a batch is the first time parts
    // are recorded, and re-running it should not double them up.
    await tx.productionItem.deleteMany({ where: { productionRecordId: id } });

    const updated = await tx.productionRecord.update({
      where: { id },
      data: {
        /*
         * The castings stage leaves the batch open - there is more to come -
         * but it is no longer merely charged, so a batch that was still
         * PENDING moves on. Leaving it there would have the list saying
         * "nothing known but the charge" about a heat whose castings are
         * counted and whose leftover metal the next heat can already claim.
         */
        status: closing
          ? "COMPLETED"
          : record.status === "PENDING"
          ? "UPDATED"
          : record.status,
        items: { create: normalisedItems },
        quantityProduced: quantityProducedNum,
        goodParts: goodPartsNum,
        rejectedParts: rejectedPartsNum,
        runnerRaiserScrap: runnerRaiserScrapNum,
        spillageScrap: spillageScrapNum,
        rejectedPartScrap: rejectedPartScrapNum,
        metalRemaining: heel,
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

    const refusal = await applyStageMoves(tx, pieceDeltas, {
      reference: "PRODUCTION",
      referenceId: id,
      notes: `Good castings from batch ${updated.batchNumber}`,
      userId,
      describe: (partId, stageKey) =>
        describeStage(stageKey, routes.get(partId) ?? [], processNames),
      partLabel: (partId) => partById.get(partId)?.partCode ?? "that part",
    });
    if (refusal) throw new PieceMoveRefused(refusal);

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
      include: { items: true, carriedTo: { select: { batchNumber: true } } },
    });
    if (!record) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // A later heat is built on the metal this one left behind. Deleting it
    // would leave that batch charged with metal from a batch that no longer
    // exists - so the later one has to go, or be amended, first.
    if (record.carriedTo) {
      return NextResponse.json(
        {
          error: `Batch ${record.carriedTo.batchNumber} was charged with the metal this batch left in the furnace. Delete or amend that batch first.`,
        },
        { status: 400 }
      );
    }

    // What this batch put on the shop floor, so it can be taken back off
    const routes = await routesFor(record.items.map((i) => i.partId));
    const processNames = await processNamesFor(routes);
    // Castings are recorded before the batch closes, so an open batch may
    // have put pieces on the floor that have to come back off
    const pieceMoves =
      record.items.length > 0
        ? productionMoves(record.items, routes)
        : new Map();
    const partCodes = new Map(
      (
        await prisma.part.findMany({
          where: { id: { in: record.items.map((i) => i.partId) } },
          select: { id: true, partCode: true },
        })
      ).map((p) => [p.id, p.partCode])
    );

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

      // The castings this batch put on the floor come back off it. Refused if
      // a station has already worked them - those pieces are past the point
      // where deleting the batch can pretend they never existed.
      const pieceRefusal = await applyStageMoves(tx, reverseMoves(pieceMoves), {
        reference: "PRODUCTION",
        referenceId: id,
        notes: `Reversed - production batch ${record.batchNumber} was deleted`,
        userId: session.id,
        describe: (partId, stageKey) =>
          describeStage(stageKey, routes.get(partId) ?? [], processNames),
        partLabel: (partId) => partCodes.get(partId) ?? "that part",
      });
      if (pieceRefusal) throw new PieceMoveRefused(pieceRefusal);

      // The line items go with it; the log entries above deliberately do not
      await tx.productionItem.deleteMany({ where: { productionRecordId: id } });
      await tx.productionRecord.delete({ where: { id } });
    });

    return NextResponse.json({
      success: true,
      message: `Batch ${record.batchNumber} deleted and its metal returned to stock`,
    });
  } catch (error) {
    if (error instanceof PieceMoveRefused) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error deleting production record:", error);
    return NextResponse.json(
      { error: "Failed to delete production record" },
      { status: 500 }
    );
  }
}
