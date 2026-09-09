import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { formatWeight } from "@/lib/units";
import { getSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { parsePagination, buildPaginationMeta } from "@/lib/pagination";
import { materialType, isIngotType, gradeName } from "@/lib/ingot";
import type { AluminumType } from "@/types";
import {
  MAX_OPEN_BATCHES_PER_FURNACE,
  batchPrefix,
  sequenceOf,
  formatBatchNumber,
} from "@/lib/production";
import { Prisma } from "@prisma/client";

/**
 * Runs `work` inside a transaction with a freshly allocated batch number,
 * retrying if another request took that number first.
 *
 * A few attempts is plenty: a clash needs two batches recorded in the same
 * moment, and each retry reads the new highest sequence.
 */
async function runWithBatchNumber<T>(
  work: (
    batchNumber: string,
    tx: Prisma.TransactionClient
  ) => Promise<T>
): Promise<T> {
  const MAX_ATTEMPTS = 5;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const batchNumber = await nextBatchNumber(new Date());
    try {
      return await prisma.$transaction((tx) => work(batchNumber, tx));
    } catch (error) {
      const clash =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        String(error.meta?.target ?? "").includes("batchNumber");

      if (!clash || attempt === MAX_ATTEMPTS) throw error;
      // Someone else took it; the next read picks up their number
    }
  }

  // Unreachable - the loop either returns or throws
  throw new Error("Could not allocate a batch number");
}

/**
 * The next batch number for the month a batch is being recorded in.
 *
 * Read from the highest sequence already used that month rather than a stored
 * counter, so there is one source of truth and nothing to fall out of step if
 * a batch is ever removed by hand.
 *
 * Two batches created at the same instant would compute the same number, so
 * the caller retries on the unique constraint - the database has the final say
 * on which one got there first.
 */
async function nextBatchNumber(when: Date): Promise<string> {
  const prefix = batchPrefix(when);

  // Only this month's numbers matter, and only ones in the current format -
  // older batches used BATCH-20260906-417 and must not be read as a sequence
  const thisMonth = await prisma.productionRecord.findMany({
    where: { batchNumber: { startsWith: prefix } },
    select: { batchNumber: true },
  });

  const highest = thisMonth.reduce((max, record) => {
    const sequence = sequenceOf(record.batchNumber, prefix);
    return sequence !== null && sequence > max ? sequence : max;
  }, 0);

  return formatBatchNumber(prefix, highest + 1);
}

// GET - List all production records
export async function GET(request: NextRequest) {
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
const { searchParams } = new URL(request.url);
    const { paginated, page, pageSize, skip, take } = parsePagination(searchParams);
    const search = searchParams.get("search")?.trim();
    const furnaceId = searchParams.get("furnaceId")?.trim();
    const status = searchParams.get("status")?.trim();
    const from = searchParams.get("from")?.trim();
    const to = searchParams.get("to")?.trim();

    // Filters run in the database so they apply across every page
    const where: Prisma.ProductionRecordWhereInput = {
      ...(search
        ? {
            OR: [
              { batchNumber: { contains: search, mode: "insensitive" as const } },
              {
                items: {
                  some: {
                    part: {
                      OR: [
                        { name: { contains: search, mode: "insensitive" as const } },
                        { partCode: { contains: search, mode: "insensitive" as const } },
                      ],
                    },
                  },
                },
              },
            ],
          }
        : {}),
      ...(furnaceId ? { furnaceId } : {}),
      // "IN_PROGRESS" is the two open stages together - that is how the floor
      // thinks of it: the batch is either finished, or it is still on the go
      ...(status === "IN_PROGRESS"
        ? { status: { in: ["PENDING", "UPDATED"] as const } }
        : status === "COMPLETED"
        ? { status: "COMPLETED" as const }
        : {}),
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
              // include the whole end day
              ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };

    const records = await prisma.productionRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...(paginated ? { skip, take } : {}),
      include: {
        items: {
          include: {
            part: {
              select: { id: true, name: true, partCode: true, weightPerPiece: true },
            },
          },
        },
        furnace: { select: { id: true, name: true } },
        user: {
          select: { name: true },
        },
      },
    });

    if (!paginated) {
      return NextResponse.json({ success: true, data: records });
    }

    const total = await prisma.productionRecord.count({ where });

    return NextResponse.json({
      success: true,
      data: records,
      pagination: buildPaginationMeta(total, { page, pageSize }),
    });
  } catch (error) {
    console.error("Error fetching production records:", error);
    return NextResponse.json(
      { error: "Failed to fetch production records" },
      { status: 500 }
    );
  }
}

// POST - Create new production record
export async function POST(request: NextRequest) {
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
const body = await request.json();
    // Creating a batch records the CHARGE only - which furnace, which alloy,
    // and what metal went in. Castings, scrap and assay figures are not known
    // when the furnace is charged, so they are added later through PATCH.
    const {
      furnaceId,
      // The alloy this heat runs on, sent explicitly. It cannot always be
      // inferred from the weights: a heat charged entirely with re-melted
      // scrap has no ingot to read a grade from.
      ingotGrade,
      aluminumUsedLM6,
      aluminumUsedLM9,
      aluminumUsedLM25,
      runnerRaiserScrapUsed,
      spillageScrapUsed,
      rejectedPartScrapUsed,
      notes,
    } = body;

    // A batch may be charged with one grade, two, or all three. The total is
    // derived from the grades so the two can never disagree.
    const ingotCharge = [
      { type: "INGOT_LM6" as const, grade: "LM6", amount: parseFloat(aluminumUsedLM6) || 0 },
      { type: "INGOT_LM9" as const, grade: "LM9", amount: parseFloat(aluminumUsedLM9) || 0 },
      { type: "INGOT_LM25" as const, grade: "LM25", amount: parseFloat(aluminumUsedLM25) || 0 },
    ];

    for (const ingot of ingotCharge) {
      if (ingot.amount < 0) {
        return NextResponse.json(
          { error: `${ingot.grade} used cannot be negative` },
          { status: 400 }
        );
      }
    }

    const aluminumUsedNum = ingotCharge.reduce((sum, i) => sum + i.amount, 0);

    // A heat runs on one alloy, and that grade governs every scrap movement
    // below - what may be re-melted in, and what grade the scrap coming off it
    // becomes. Taken from the caller when given; otherwise from whichever
    // grade holds the most metal, which is how older callers expressed it.
    const batchIngotType =
      typeof ingotGrade === "string" && isIngotType(ingotGrade as AluminumType)
        ? (ingotGrade as AluminumType)
        : materialType(
            "INGOT",
            ingotCharge.reduce((best, i) => (i.amount > best.amount ? i : best))
              .grade
          );
    const batchGrade = gradeName(batchIngotType);

    if (!furnaceId) {
      return NextResponse.json(
        { error: "Furnace is required" },
        { status: 400 }
      );
    }

    const furnace = await prisma.furnace.findUnique({ where: { id: furnaceId } });
    if (!furnace) {
      return NextResponse.json({ error: "Furnace not found" }, { status: 404 });
    }
    if (!furnace.isActive) {
      return NextResponse.json(
        { error: "That furnace is no longer active" },
        { status: 400 }
      );
    }

    // A furnace may only carry so many unfinished batches. Past that, the
    // open ones have to be closed first - otherwise the paperwork drifts
    // further behind the metal with every heat.
    const openOnFurnace = await prisma.productionRecord.count({
      where: { furnaceId, status: { in: ["PENDING", "UPDATED"] } },
    });
    if (openOnFurnace >= MAX_OPEN_BATCHES_PER_FURNACE) {
      return NextResponse.json(
        {
          error: `${furnace.name} already has ${openOnFurnace} batches waiting to be completed. Complete those before starting another on this furnace.`,
        },
        { status: 400 }
      );
    }

    // Scrap is graded, and a heat may only re-melt scrap of its own alloy -
    // charging LM9 runners into an LM6 heat would put the melt out of spec. So
    // the batch grade decides which stock lines these weights move.
    const scrapUsed = [
      {
        type: materialType("RUNNER_RAISER", batchGrade),
        label: `${batchGrade} Runner & Raiser`,
        amount: parseFloat(runnerRaiserScrapUsed) || 0,
      },
      {
        type: materialType("SPILLAGE", batchGrade),
        label: `${batchGrade} Spillage`,
        amount: parseFloat(spillageScrapUsed) || 0,
      },
      {
        type: materialType("REJECTED_PART", batchGrade),
        label: `${batchGrade} Rejected Part`,
        amount: parseFloat(rejectedPartScrapUsed) || 0,
      },
    ];

    for (const scrap of scrapUsed) {
      if (scrap.amount < 0) {
        return NextResponse.json(
          { error: `${scrap.label} scrap used cannot be negative` },
          { status: 400 }
        );
      }
    }

    const totalScrapUsedNum = scrapUsed.reduce((sum, s) => sum + s.amount, 0);

    // Something has to go into the furnace, but it does not have to be fresh
    // ingot - a heat run entirely on re-melted scrap is ordinary foundry work.
    // So the requirement is on the CHARGE, not on the ingot alone.
    if (aluminumUsedNum + totalScrapUsedNum <= 0) {
      return NextResponse.json(
        { error: "Enter the ingot or the scrap charged into this heat" },
        { status: 400 }
      );
    }

    // Each grade is its own stock line, so each is checked on its own
    for (const ingot of ingotCharge) {
      if (ingot.amount <= 0) continue;
      const stock = await prisma.inventory.findUnique({ where: { type: ingot.type } });
      const available = stock?.quantity ?? 0;
      if (available < ingot.amount) {
        return NextResponse.json(
          {
            error: `Not enough ${ingot.grade} ingot in stock - ${formatWeight(available)} available`,
          },
          { status: 400 }
        );
      }
    }

    // A batch can consume and generate the same scrap type, so availability is
    // checked against stock as it stands now - before this batch's own scrap
    // is added.
    for (const scrap of scrapUsed) {
      if (scrap.amount <= 0) continue;
      const stock = await prisma.inventory.findUnique({ where: { type: scrap.type } });
      const available = stock?.quantity ?? 0;
      if (available < scrap.amount) {
        return NextResponse.json(
          {
            error: `Not enough ${scrap.label} scrap in stock - ${formatWeight(available)} available`,
          },
          { status: 400 }
        );
      }
    }

    // Create production record and update inventories in a transaction.
    //
    // The batch number is computed inside the retry: two heats recorded at the
    // same instant would work out the same number, and the unique constraint
    // is what decides which one got there first. Recomputing on a clash is
    // simpler and safer than holding a lock or a separate counter table.
    const result = await runWithBatchNumber(async (batchNumber, tx) => {
      // Create production record
      const record = await tx.productionRecord.create({
        data: {
          batchNumber,
          furnaceId,
          // The batch opens as PENDING: the metal is in the furnace, nothing
          // has come out of it yet. Output, scrap and assay stay at their
          // defaults until the later stages fill them in.
          status: "PENDING",
          aluminumUsed: aluminumUsedNum,
          ingotGrade: batchIngotType,
          aluminumUsedLM6: ingotCharge[0].amount,
          aluminumUsedLM9: ingotCharge[1].amount,
          aluminumUsedLM25: ingotCharge[2].amount,
          runnerRaiserScrapUsed: scrapUsed[0].amount,
          spillageScrapUsed: scrapUsed[1].amount,
          rejectedPartScrapUsed: scrapUsed[2].amount,
          totalScrapUsed: totalScrapUsedNum,
          notes: notes || null,
          createdBy: session.id,
        },
        include: {
          items: {
            include: {
              part: { select: { id: true, name: true, partCode: true } },
            },
          },
          furnace: { select: { id: true, name: true } },
          user: { select: { name: true } },
        },
      });

      // Deduct each grade from its own stock line, with its own log entry, so
      // the audit trail says which metal actually went into the furnace.
      for (const ingot of ingotCharge) {
        if (ingot.amount <= 0) continue;

        const stock = await tx.inventory.findUnique({ where: { type: ingot.type } });
        const prevQty = stock?.quantity ?? 0;

        await tx.inventory.update({
          where: { type: ingot.type },
          data: { quantity: { decrement: ingot.amount }, lastUpdated: new Date() },
        });

        await tx.inventoryLog.create({
          data: {
            type: ingot.type,
            action: "REMOVE",
            quantity: -ingot.amount,
            previousQty: prevQty,
            newQty: prevQty - ingot.amount,
            reference: "Production",
            referenceId: record.id,
            notes: `Used in production batch ${batchNumber}`,
            createdBy: session.id,
          },
        });
      }

      // Deduct any scrap charged back into the melt. This runs before the new
      // scrap is added so the log's previousQty/newQty read in the order the
      // metal actually moved.
      for (const scrap of scrapUsed) {
        if (scrap.amount <= 0) continue;

        const stock = await tx.inventory.findUnique({ where: { type: scrap.type } });
        const prevQty = stock?.quantity ?? 0;

        await tx.inventory.update({
          where: { type: scrap.type },
          data: { quantity: { decrement: scrap.amount }, lastUpdated: new Date() },
        });

        await tx.inventoryLog.create({
          data: {
            type: scrap.type,
            action: "REMOVE",
            quantity: -scrap.amount,
            previousQty: prevQty,
            newQty: prevQty - scrap.amount,
            reference: "Production",
            referenceId: record.id,
            notes: `Re-melted in production batch ${batchNumber}`,
            createdBy: session.id,
          },
        });
      }

      return record;
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    console.error("Error creating production record:", error);
    return NextResponse.json(
      { error: "Failed to create production record" },
      { status: 500 }
    );
  }
}
