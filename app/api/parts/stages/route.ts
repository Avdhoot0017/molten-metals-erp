import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { stageColumns } from "@/lib/pieces";

/**
 * Where every part's pieces are standing right now.
 *
 * The counterpart to the blocking rule: an operator told "only 6 are at Belt
 * Sander" needs to be able to see that before they type 10, not after. The
 * fettling form reads this to show a queue against each part.
 *
 * Empty stages are left out - a station holding nothing is not news.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canRead(session, "fettling") && !canRead(session, "production")) {
      return NextResponse.json(
        { error: "You do not have permission to view this data" },
        { status: 403 }
      );
    }

    const partId = request.nextUrl.searchParams.get("partId");

    const stages = await prisma.partStage.findMany({
      where: {
        quantity: { not: 0 },
        ...(partId ? { partId } : {}),
      },
      select: {
        partId: true,
        stageKey: true,
        kind: true,
        routeStepId: true,
        quantity: true,
        // When this queue last changed - enough to say "these have been
        // sitting here since Tuesday" without replaying the whole ledger
        lastUpdated: true,
        routeStep: {
          select: {
            sequence: true,
            activityTypeId: true,
            activityType: { select: { id: true, name: true } },
          },
        },
        part: { select: { partCode: true, name: true } },
      },
      orderBy: [{ partId: "asc" }, { stageKey: "asc" }],
    });

    return NextResponse.json({ success: true, data: stages });
  } catch (error) {
    console.error("Error fetching part stages:", error);
    return NextResponse.json(
      { error: "Failed to fetch where parts are" },
      { status: 500 }
    );
  }
}

/**
 * POST - a stock-take: set what is physically at one place.
 *
 * Tracking has to start somewhere, and on the day it is switched on the floor
 * is already full of half-finished work. Rebuilding that from history is not
 * possible - the history is the double-counted figures this replaces - so
 * somebody walks the floor and counts.
 *
 * It SETS the figure rather than moving pieces, and is logged as a count. A
 * movement says "these pieces went from here to there" and has a station's
 * work behind it; a count says "this is what is actually here", and the two
 * must never be confused in the history.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Setting a balance outright is a correction, not data entry - it is held
    // to the same bar as amending stock
    if (!canWrite(session, "production")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const { partId, stageKey, quantity, notes } = await request.json();

    if (!partId || !stageKey) {
      return NextResponse.json(
        { error: "A part and a place are required" },
        { status: 400 }
      );
    }

    const counted = Number(quantity);
    if (!Number.isInteger(counted) || counted < 0) {
      return NextResponse.json(
        { error: "The count must be a whole number of 0 or more" },
        { status: 400 }
      );
    }

    const part = await prisma.part.findUnique({
      where: { id: partId },
      select: { id: true, partCode: true },
    });
    if (!part) {
      return NextResponse.json({ error: "Part not found" }, { status: 404 });
    }

    // A key has to name a real place. A malformed one ("STEP:" with nothing
    // after it) would otherwise reach the database as an empty foreign key and
    // come back as a server error rather than a usable message.
    if (
      stageKey !== "READY" &&
      !/^(STEP|REWORK):[A-Za-z0-9_-]+$/.test(String(stageKey))
    ) {
      return NextResponse.json(
        { error: "That is not a place pieces can be counted at" },
        { status: 400 }
      );
    }

    const columns = stageColumns(stageKey);
    // A station's queue has to be a real step of that part's route, or the
    // pieces would be standing somewhere that does not exist
    if (columns.routeStepId) {
      const step = await prisma.partRouteStep.findFirst({
        where: { id: columns.routeStepId, partId },
      });
      if (!step) {
        return NextResponse.json(
          { error: "That station is not on this part's route" },
          { status: 400 }
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.partStage.findUnique({
        where: { partId_stageKey: { partId, stageKey } },
      });
      const previousQty = existing?.quantity ?? 0;

      const stage = await tx.partStage.upsert({
        where: { partId_stageKey: { partId, stageKey } },
        update: { quantity: counted, lastUpdated: new Date() },
        create: {
          partId,
          stageKey,
          kind: columns.kind,
          routeStepId: columns.routeStepId,
          quantity: counted,
        },
      });

      await tx.partStageLog.create({
        data: {
          partId,
          stageKey,
          quantity: counted - previousQty,
          previousQty,
          newQty: counted,
          reference: "STOCKTAKE",
          notes:
            (typeof notes === "string" && notes.trim()) ||
            `Counted ${counted} (was ${previousQty})`,
          createdBy: session.id,
        },
      });

      return stage;
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Error saving stock-take:", error);
    return NextResponse.json(
      { error: "Failed to save that count" },
      { status: 500 }
    );
  }
}
