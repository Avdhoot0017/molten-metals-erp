import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { formatWeight } from "@/lib/units";
import { getSession } from "@/lib/auth";
import { canRead, canWrite, canAmendCompletedBatch } from "@/lib/permissions";
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
        operator: { select: { id: true, name: true, employeeCode: true } },
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
      // The batch whose leftover metal is being melted into this one, if any
      carriedFromId,
      // The shop-floor employee who ran this heat
      operatorId,
      /*
       * Writing up a heat that ran weeks ago - admin only.
       *
       * The month's numbering is part of the record, so a batch from last
       * month has to carry last month's number and date. Both are taken from
       * the caller rather than invented, and both are checked: the number must
       * be free and must belong to the month the date falls in, or the
       * sequence stops meaning anything.
       */
      batchNumber: requestedNumber,
      date: requestedDate,
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

    /*
     * Metal carried over from the previous heat on this furnace.
     *
     * This is the one part of the charge that moves no stock. It was deducted
     * from inventory when that earlier batch was charged and has been sitting
     * in the furnace ever since; taking it out again would remove the same
     * kilos from stock twice.
     */
    let carriedIn = 0;
    let heelSource: { id: string; batchNumber: string } | null = null;

    if (carriedFromId) {
      const source = await prisma.productionRecord.findUnique({
        where: { id: String(carriedFromId) },
        include: { carriedTo: { select: { batchNumber: true } } },
      });

      if (!source) {
        return NextResponse.json(
          { error: "That batch does not exist" },
          { status: 404 }
        );
      }
      /*
       * The batch need not be closed, only counted.
       *
       * What it leaves behind is known the moment its castings are counted -
       * charge less what was poured - and the metal is in the furnace from
       * then on. Waiting for the scrap to be weighed would mean the next heat
       * could not be charged with metal that is physically sitting in front of
       * the operator.
       */
      if (!source.metalRemaining || source.metalRemaining <= 0) {
        return NextResponse.json(
          { error: `Batch ${source.batchNumber} has no metal left to carry over` },
          { status: 400 }
        );
      }
      // The database enforces this too; catching it here gives a usable message
      if (source.carriedTo) {
        return NextResponse.json(
          {
            error: `That metal has already been melted into batch ${source.carriedTo.batchNumber}`,
          },
          { status: 400 }
        );
      }
      // Molten metal does not move between furnaces on its own
      if (source.furnaceId !== (furnaceId || null)) {
        return NextResponse.json(
          {
            error: `Batch ${source.batchNumber} ran on a different furnace - its metal is still in that one`,
          },
          { status: 400 }
        );
      }
      // Pouring an LM6 heel into an LM9 heat contaminates the alloy, the same
      // reason scrap is kept per grade
      if (source.ingotGrade !== batchIngotType) {
        return NextResponse.json(
          {
            error: `Batch ${source.batchNumber} left ${gradeName(source.ingotGrade)} metal, which cannot be melted into a ${gradeName(batchIngotType)} heat`,
          },
          { status: 400 }
        );
      }

      carriedIn = source.metalRemaining;
      heelSource = { id: source.id, batchNumber: source.batchNumber };
    }

    /*
     * Who ran the heat - optional.
     *
     * Worth recording, because "who was on the furnace" is the question asked
     * when a batch looks wrong and the login name does not answer it. But not
     * required: a heat still has to be recordable at a terminal where nobody
     * knows the operator's code, and refusing the batch would lose the whole
     * entry over a field that is only a label.
     *
     * Never defaulted to the logged-in user either - the person typing is
     * usually a manager writing up somebody else's shift, and a batch quietly
     * stamped with the wrong name is worse than one with none.
     */
    let operator: { id: string; name: string } | null = null;
    if (operatorId) {
      const found = await prisma.employee.findUnique({
        where: { id: String(operatorId) },
        select: { id: true, isActive: true, name: true },
      });
      if (!found) {
        return NextResponse.json({ error: "Employee not found" }, { status: 404 });
      }
      if (!found.isActive) {
        return NextResponse.json(
          { error: `${found.name} is no longer active` },
          { status: 400 }
        );
      }
      operator = { id: found.id, name: found.name };
    }

    /*
     * A backdated entry is a correction to the record, not routine work, so it
     * is held to the same bar as amending a completed batch: admins only.
     */
    let backdated: { batchNumber: string; date: Date } | null = null;
    if (requestedNumber || requestedDate) {
      if (!canAmendCompletedBatch(session)) {
        return NextResponse.json(
          { error: "Only an admin can add a batch for an earlier date" },
          { status: 403 }
        );
      }

      const when = requestedDate ? new Date(String(requestedDate)) : new Date();
      if (Number.isNaN(when.getTime())) {
        return NextResponse.json(
          { error: "That date is not a real date" },
          { status: 400 }
        );
      }
      // A heat cannot have run after today
      if (when.getTime() > Date.now()) {
        return NextResponse.json(
          { error: "A batch cannot be dated in the future" },
          { status: 400 }
        );
      }

      const prefix = batchPrefix(when);
      const number = String(requestedNumber ?? "").trim().toUpperCase();
      const sequence = sequenceOf(number, prefix);
      if (sequence === null) {
        return NextResponse.json(
          {
            error: `Batch number must be ${prefix} followed by two digits for that month - for example ${formatBatchNumber(prefix, 1)}`,
          },
          { status: 400 }
        );
      }

      const clash = await prisma.productionRecord.findUnique({
        where: { batchNumber: number },
        select: { date: true },
      });
      if (clash) {
        // Say which number IS free, so the next attempt is not another guess
        const free = await nextBatchNumber(when);
        return NextResponse.json(
          {
            error: `Batch ${number} already exists (recorded ${clash.date.toISOString().slice(0, 10)}). The next free number for that month is ${free}.`,
          },
          { status: 409 }
        );
      }

      backdated = { batchNumber: number, date: when };
    }

    // Something has to go into the furnace, but it does not have to be fresh
    // ingot - a heat run entirely on re-melted scrap, or entirely on what the
    // last heat left behind, is ordinary foundry work. So the requirement is on
    // the CHARGE, not on the ingot alone.
    if (aluminumUsedNum + totalScrapUsedNum + carriedIn <= 0) {
      return NextResponse.json(
        {
          error:
            "Enter the ingot or the scrap charged into this heat, or carry over the metal left in the furnace",
        },
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
    /*
     * A backdated batch brings its own number, so the allocator is skipped -
     * it exists to hand out the NEXT number, and that is not what is wanted
     * here. The unique constraint still has the final say if two people claim
     * the same number at the same moment.
     */
    const withNumber = backdated
      ? <T,>(work: (n: string, tx: Prisma.TransactionClient) => Promise<T>) =>
          prisma.$transaction((tx) => work(backdated!.batchNumber, tx))
      : runWithBatchNumber;

    const result = await withNumber(async (batchNumber, tx) => {
      // Create production record
      const record = await tx.productionRecord.create({
        data: {
          batchNumber,
          ...(backdated ? { date: backdated.date } : {}),
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
          // Part of the charge, deliberately absent from every stock movement
          // below - this metal never went back into inventory to be taken out
          carriedInWeight: carriedIn,
          carriedFromId: heelSource?.id ?? null,
          operatorId: operator?.id ?? null,
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
          operator: { select: { id: true, name: true, employeeCode: true } },
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
    /*
     * Two people claiming one number at the same moment.
     *
     * The check before saving catches the ordinary case; this catches the
     * gap between that check and the write, where the database is the only
     * thing that can decide. Only backdated batches can land here - the
     * allocator retries on a clash by itself.
     */
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      String(error.meta?.target ?? "").includes("batchNumber")
    ) {
      return NextResponse.json(
        { error: "That batch number was just taken. Try the next one." },
        { status: 409 }
      );
    }
    console.error("Error creating production record:", error);
    return NextResponse.json(
      { error: "Failed to create production record" },
      { status: 500 }
    );
  }
}
