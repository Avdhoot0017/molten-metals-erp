import { NextResponse } from "next/server";
import { ingotSplit, isIngotType, isScrapType } from "@/lib/ingot";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canRead(session, "analytics")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }
// Get date range (last 30 days by default)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Fetch production records
    const productionRecords = await prisma.productionRecord.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
      },
      include: {
        items: {
          include: { part: { select: { name: true, partCode: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Fetch purchase orders
    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    // Fetch current inventory
    const inventory = await prisma.inventory.findMany();

    // Calculate summary stats
    const totalProduction = productionRecords.reduce(
      (sum, r) => sum + r.goodParts,
      0
    );
    const totalScrap = productionRecords.reduce(
      (sum, r) => sum + r.totalScrap,
      0
    );
    const avgEfficiency =
      productionRecords.length > 0
        ? productionRecords.reduce((sum, r) => sum + r.efficiency, 0) /
          productionRecords.length
        : 0;
    const totalPurchases = purchaseOrders.reduce(
      (sum, po) => sum + po.quantity,
      0
    );
    const purchaseValue = purchaseOrders.reduce(
      (sum, po) => sum + po.totalAmount,
      0
    );

    // Calculate efficiency trend by week
    const efficiencyByWeek: { [key: string]: { total: number; count: number } } = {};
    productionRecords.forEach((record) => {
      const weekNum = getWeekNumber(record.createdAt);
      const weekKey = `Week ${weekNum}`;
      if (!efficiencyByWeek[weekKey]) {
        efficiencyByWeek[weekKey] = { total: 0, count: 0 };
      }
      efficiencyByWeek[weekKey].total += record.efficiency;
      efficiencyByWeek[weekKey].count += 1;
    });

    const efficiencyTrend = Object.entries(efficiencyByWeek).map(
      ([date, data]) => ({
        date,
        efficiency: data.count > 0 ? data.total / data.count : 0,
      })
    );

    // Sort by week number
    efficiencyTrend.sort((a, b) => {
      const weekA = parseInt(a.date.replace("Week ", ""));
      const weekB = parseInt(b.date.replace("Week ", ""));
      return weekA - weekB;
    });

    // Production by part - a batch can contain several parts, so count each line
    const productionByPart: { [key: string]: number } = {};
    productionRecords.forEach((record) => {
      record.items.forEach((item) => {
        const partName = item.part?.name || "Unknown";
        productionByPart[partName] = (productionByPart[partName] || 0) + item.goodParts;
      });
    });

    const productionByPartArray = Object.entries(productionByPart)
      .map(([part, quantity]) => ({
        part,
        quantity,
        percentage: totalProduction > 0 ? (quantity / totalProduction) * 100 : 0,
      }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    // Scrap breakdown
    const runnerRaiserScrap = productionRecords.reduce(
      (sum, r) => sum + r.runnerRaiserScrap,
      0
    );
    const spillageScrap = productionRecords.reduce(
      (sum, r) => sum + r.spillageScrap,
      0
    );
    const rejectedPartScrap = productionRecords.reduce(
      (sum, r) => sum + r.rejectedPartScrap,
      0
    );

    const scrapBreakdown = [
      {
        type: "Runner & Raiser",
        quantity: runnerRaiserScrap,
        percentage: totalScrap > 0 ? (runnerRaiserScrap / totalScrap) * 100 : 0,
        color: "bg-blue-500",
      },
      {
        type: "Spillage",
        quantity: spillageScrap,
        percentage: totalScrap > 0 ? (spillageScrap / totalScrap) * 100 : 0,
        color: "bg-orange-500",
      },
      {
        type: "Rejected Parts",
        quantity: rejectedPartScrap,
        percentage: totalScrap > 0 ? (rejectedPartScrap / totalScrap) * 100 : 0,
        color: "bg-red-500",
      },
    ];

    // Ingot charged over the period, split by grade. The mirror image of the
    // scrap breakdown above: that says what came out, this says what went in
    // and which alloy it was.
    const totalIngotCharged = productionRecords.reduce(
      (sum, r) => sum + r.aluminumUsed,
      0
    );
    const ingotBreakdown = ingotSplit({
      INGOT_LM6: productionRecords.reduce((sum, r) => sum + r.aluminumUsedLM6, 0),
      INGOT_LM9: productionRecords.reduce((sum, r) => sum + r.aluminumUsedLM9, 0),
      INGOT_LM25: productionRecords.reduce((sum, r) => sum + r.aluminumUsedLM25, 0),
    });

    // Inventory trend (current values only for now)
    // Ingot is stocked per grade, so the trend line is the sum of the grades
    const inventoryMap = inventory.reduce((acc, i) => {
      acc[i.type] = i.quantity;
      return acc;
    }, {} as Record<string, number>);
    const ingotInventory = inventory
      .filter((i) => isIngotType(i.type))
      .reduce((sum, i) => sum + i.quantity, 0);
    const scrapInventory = inventory
      .filter((i) => isScrapType(i.type))
      .reduce((sum, i) => sum + i.quantity, 0);
    const ingotStockByGrade = ingotSplit(inventoryMap);

    // Top clients (companies with most dispatches would come from dispatch records)
    // For now, we'll use companies data
    const companies = await prisma.company.findMany({
      take: 3,
      orderBy: { name: "asc" },
    });

    const topClients = companies.map((company) => ({
      name: company.name,
      dispatched: 0, // Would need dispatch records
      orders: 0,
    }));

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalProduction,
          totalScrap,
          totalIngotCharged,
          avgEfficiency: parseFloat(avgEfficiency.toFixed(1)),
          totalPurchases,
          purchaseValue,
        },
        trends: {
          production: 0, // Would need comparison with previous period
          efficiency: 0,
          scrapRate: 0,
          purchases: 0,
        },
        efficiencyTrend,
        productionByPart: productionByPartArray,
        scrapBreakdown,
        ingotBreakdown,
        ingotStockByGrade,
        inventoryTrend: [
          {
            date: "Current",
            ingot: ingotInventory,
            scrap: scrapInventory,
          },
        ],
        topClients,
      },
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}

// Helper function to get week number
function getWeekNumber(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const diff = date.getTime() - startOfYear.getTime();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.ceil(diff / oneWeek);
}
