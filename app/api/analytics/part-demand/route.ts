import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { READY_STAGE } from "@/lib/pieces";
import {
  demandFigures,
  sumDemand,
  dayKey,
  dayKeys,
  EXCLUDED_ORDER_STATUS,
  type PartDemandFigures,
} from "@/lib/demand";

/**
 * Part by part: what customers have ordered against what the shop has made.
 *
 * Kept out of /api/dashboard on purpose. It reads customer orders, which the
 * shop-floor roles may not see, and it is the one block of the dashboard
 * that can be refused on its own - the page simply leaves the section out
 * rather than failing whole.
 *
 * Every figure is PIECES. Nothing here is a weight.
 */

/** How many days of history the trend line covers. */
const TREND_DAYS = 30;

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Customer requirements are commercial figures, so this follows access to
    // customer orders rather than to the dashboard
    if (!canRead(session, "customerOrders")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const companyFilter = searchParams.get("companyId");

    const trendStart = new Date();
    trendStart.setHours(0, 0, 0, 0);
    trendStart.setDate(trendStart.getDate() - (TREND_DAYS - 1));

    const [parts, orderLines, unmatchedLines, dispatchLines, stageRows, readyLog] =
      await Promise.all([
        prisma.part.findMany({
          where: { isActive: true },
          orderBy: { partCode: "asc" },
          select: { id: true, partCode: true, name: true, weightPerPiece: true },
        }),

        // What has been ordered. A cancelled order is not a commitment.
        prisma.customerOrderItem.findMany({
          where: {
            partId: { not: null },
            order: {
              status: { not: EXCLUDED_ORDER_STATUS },
              ...(companyFilter ? { companyId: companyFilter } : {}),
            },
          },
          select: {
            partId: true,
            quantity: true,
            order: {
              select: {
                id: true,
                poNumber: true,
                companyId: true,
                company: { select: { name: true } },
              },
            },
          },
        }),

        /*
         * Order lines nobody has matched to one of our parts.
         *
         * They cannot be counted against output - there is no part to count
         * them against - so they are counted HERE instead and said out loud
         * on the page. Silently leaving them out is how a requirement figure
         * ends up quietly too low and nobody notices.
         */
        prisma.customerOrderItem.count({
          where: {
            partId: null,
            order: {
              status: { not: EXCLUDED_ORDER_STATUS },
              ...(companyFilter ? { companyId: companyFilter } : {}),
            },
          },
        }),

        // What has gone out
        prisma.dispatchItem.findMany({
          where: companyFilter
            ? { dispatch: { companyId: companyFilter } }
            : undefined,
          select: {
            partId: true,
            quantity: true,
            dispatch: {
              select: {
                companyId: true,
                dispatchDate: true,
                company: { select: { name: true } },
              },
            },
          },
        }),

        // Where the pieces are right now
        prisma.partStage.findMany({
          where: { quantity: { not: 0 } },
          select: { partId: true, kind: true, quantity: true },
        }),

        /*
         * The trend, read off the finished-stock ledger.
         *
         * A move INTO finished stock is a piece the shop completed that day;
         * a move out is a piece that left on a delivery note. Both series
         * come from the same rows, so the chart cannot disagree with the
         * table above it.
         */
        prisma.partStageLog.findMany({
          where: { stageKey: READY_STAGE, createdAt: { gte: trendStart } },
          select: { quantity: true, createdAt: true },
        }),
      ]);

    // ---- Ordered, per part and per customer ---------------------------
    interface CustomerLine {
      companyId: string;
      name: string;
      ordered: number;
      dispatched: number;
      orders: Set<string>;
    }
    const customersByPart = new Map<string, Map<string, CustomerLine>>();
    const orderedByPart = new Map<string, number>();

    const customerLine = (partId: string, companyId: string, name: string) => {
      const forPart = customersByPart.get(partId) ?? new Map<string, CustomerLine>();
      const line =
        forPart.get(companyId) ??
        { companyId, name, ordered: 0, dispatched: 0, orders: new Set<string>() };
      forPart.set(companyId, line);
      customersByPart.set(partId, forPart);
      return line;
    };

    for (const item of orderLines) {
      const partId = item.partId;
      if (!partId) continue;
      // Orders are placed in whole pieces; a fractional line is rounded the
      // way the shop would read it rather than dropped
      const quantity = Math.round(item.quantity);
      orderedByPart.set(partId, (orderedByPart.get(partId) ?? 0) + quantity);
      const line = customerLine(partId, item.order.companyId, item.order.company.name);
      line.ordered += quantity;
      line.orders.add(item.order.poNumber);
    }

    // ---- Delivered, per part and per customer -------------------------
    const dispatchedByPart = new Map<string, number>();
    const dispatchedByDay = new Map<string, number>();

    for (const item of dispatchLines) {
      dispatchedByPart.set(
        item.partId,
        (dispatchedByPart.get(item.partId) ?? 0) + item.quantity
      );
      const line = customerLine(
        item.partId,
        item.dispatch.companyId,
        item.dispatch.company.name
      );
      line.dispatched += item.quantity;
      const key = dayKey(item.dispatch.dispatchDate);
      dispatchedByDay.set(key, (dispatchedByDay.get(key) ?? 0) + item.quantity);
    }

    // ---- Where the pieces are -----------------------------------------
    const piecesByPart = new Map<
      string,
      { waiting: number; rework: number; ready: number }
    >();
    for (const row of stageRows) {
      const current =
        piecesByPart.get(row.partId) ?? { waiting: 0, rework: 0, ready: 0 };
      if (row.kind === "WAITING") current.waiting += row.quantity;
      else if (row.kind === "REWORK") current.rework += row.quantity;
      else current.ready += row.quantity;
      piecesByPart.set(row.partId, current);
    }

    // ---- One row per part ----------------------------------------------
    const rows = parts.map((part) => {
      const pieces =
        piecesByPart.get(part.id) ?? { waiting: 0, rework: 0, ready: 0 };
      const figures = demandFigures({
        required: orderedByPart.get(part.id) ?? 0,
        dispatched: dispatchedByPart.get(part.id) ?? 0,
        ...pieces,
      });

      const customers = [...(customersByPart.get(part.id)?.values() ?? [])]
        .map((line) => ({
          companyId: line.companyId,
          name: line.name,
          ordered: line.ordered,
          dispatched: line.dispatched,
          outstanding: Math.max(0, line.ordered - line.dispatched),
          orders: line.orders.size,
        }))
        // Whoever is owed the most comes first - that is the question being
        // asked of this list
        .sort((a, b) => b.outstanding - a.outstanding || b.ordered - a.ordered);

      return {
        id: part.id,
        partCode: part.partCode,
        name: part.name,
        weightPerPiece: part.weightPerPiece,
        ...figures,
        customerCount: customers.length,
        customers,
      };
    });

    /*
     * Parts nobody has ordered sit below the ones that have been, rather than
     * being dropped: a part being made for stock is still worth seeing, but
     * it is not what this list is for.
     */
    rows.sort((a, b) => {
      if ((b.required > 0 ? 1 : 0) !== (a.required > 0 ? 1 : 0)) {
        return (b.required > 0 ? 1 : 0) - (a.required > 0 ? 1 : 0);
      }
      return b.pending - a.pending || b.required - a.required;
    });

    // ---- The trend line --------------------------------------------------
    const finishedByDay = new Map<string, number>();
    for (const log of readyLog) {
      const key = dayKey(log.createdAt);
      if (log.quantity > 0) {
        finishedByDay.set(key, (finishedByDay.get(key) ?? 0) + log.quantity);
      }
    }

    const trend = dayKeys(TREND_DAYS).map((key) => ({
      date: key,
      finished: finishedByDay.get(key) ?? 0,
      dispatched: dispatchedByDay.get(key) ?? 0,
    }));

    const totals = sumDemand(rows as PartDemandFigures[]);

    return NextResponse.json({
      success: true,
      data: {
        parts: rows,
        totals: {
          ...totals,
          partsOrdered: rows.filter((row) => row.required > 0).length,
          /** PO lines not yet matched to a part, so not counted above. */
          unmatchedOrderLines: unmatchedLines,
          customers: new Set(
            rows.flatMap((row) => row.customers.map((c) => c.companyId))
          ).size,
        },
        trend,
        trendDays: TREND_DAYS,
      },
    });
  } catch (error) {
    console.error("Error building part demand:", error);
    return NextResponse.json(
      { error: "Failed to load part demand" },
      { status: 500 }
    );
  }
}
