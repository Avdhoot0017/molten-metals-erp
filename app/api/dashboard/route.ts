import { NextResponse } from "next/server";
import {
  GRADE_NAMES,
  ingotSplit,
  materialType,
  scrapSplit,
  totalIngot,
  type MaterialForm,
} from "@/lib/ingot";
import prisma from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getSession } from "@/lib/auth";

// GET - Dashboard statistics
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get current inventory levels
    const inventory = await prisma.inventory.findMany();
    const inventoryMap = inventory.reduce((acc, inv) => {
      acc[inv.type] = inv.quantity;
      return acc;
    }, {} as Record<string, number>);

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get this month's date range
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // Today's production
    const todayProduction = await prisma.productionRecord.aggregate({
      where: {
        date: {
          gte: today,
          lt: tomorrow,
        },
      },
      _sum: {
        goodParts: true,
        aluminumUsed: true,
        aluminumUsedLM6: true,
        aluminumUsedLM9: true,
        aluminumUsedLM25: true,
        totalScrap: true,
      },
      _count: true,
    });

    // This month's production
    const monthProduction = await prisma.productionRecord.aggregate({
      where: {
        date: {
          gte: monthStart,
          lte: monthEnd,
        },
      },
      _sum: {
        goodParts: true,
        rejectedParts: true,
        aluminumUsed: true,
        aluminumUsedLM6: true,
        aluminumUsedLM9: true,
        aluminumUsedLM25: true,
        totalScrap: true,
      },
      _avg: {
        efficiency: true,
      },
      _count: true,
    });

    // Pending purchase orders
    const pendingOrders = await prisma.purchaseOrder.count({
      where: {
        status: {
          in: ["PENDING", "CONFIRMED", "IN_TRANSIT"],
        },
      },
    });

    // Recent production records
    const recentProduction = await prisma.productionRecord.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          include: { part: { select: { name: true, partCode: true } } },
        },
        user: { select: { name: true } },
      },
    });

    // Recent purchase orders
    const recentOrders = await prisma.purchaseOrder.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        supplier: { select: { name: true } },
      },
    });

    // Recent inventory logs
    const recentLogs = await prisma.inventoryLog.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true } },
      },
    });

    // Low stock alerts. The threshold is set in Settings > System rather than
    // fixed here, so a foundry can pitch it at its own reorder point.
    const { lowStockThreshold } = await getSettings();

    // A line that has never held anything is not "running low" - it is a grade
    // this plant does not stock. Flagging all of them buries the one line that
    // genuinely dropped, which is the whole point of the alert.
    const lowStockItems = inventory.filter(
      (inv) => inv.quantity > 0 && inv.quantity < lowStockThreshold
    );

    // Calculate total aluminum (all types)
    const totalAluminum = inventory.reduce((sum, inv) => sum + inv.quantity, 0);

    // Ingot vs scrap breakdown
    // Every ingot grade rolls up into one headline ingot figure, and the grades
    // are also sent through separately - LM6, LM9 and LM25 are different metal,
    // so a single ingot number hides which alloy is actually running out.
    const ingotStock = totalIngot(inventoryMap);
    const ingotByGrade = ingotSplit(inventoryMap);

    // Scrap is graded too, so each headline scrap figure is the sum of that
    // form across the three alloys, and scrapByGrade gives the other cut.
    const scrapStockFor = (form: MaterialForm) =>
      GRADE_NAMES.reduce(
        (sum, grade) => sum + (inventoryMap[materialType(form, grade)] ?? 0),
        0
      );
    const runnerRaiserStock = scrapStockFor("RUNNER_RAISER");
    const spillageStock = scrapStockFor("SPILLAGE");
    const rejectedPartStock = scrapStockFor("REJECTED_PART");
    const totalScrap = runnerRaiserStock + spillageStock + rejectedPartStock;
    const scrapByGrade = scrapSplit(inventoryMap);

    // Parts count
    const partsCount = await prisma.part.count({ where: { isActive: true } });

    // Per-part production analytics
    const activeParts = await prisma.part.findMany({
      where: { isActive: true },
      select: {
        id: true,
        partCode: true,
        name: true,
        weightPerPiece: true,
        expectedScrap: true,
      },
      orderBy: { partCode: "asc" },
    });

    // A batch can hold several parts, so per-part figures are rolled up from
    // the line items. Aluminium and scrap are recorded per batch, so they are
    // apportioned across a batch's parts by each part's share of the output
    // weight (good parts x weight per piece).
    const productionItems = await prisma.productionItem.findMany({
      include: {
        productionRecord: {
          select: { id: true, aluminumUsed: true, totalScrap: true, efficiency: true },
        },
        part: { select: { weightPerPiece: true } },
      },
    });

    // Output weight per batch, used as the apportioning denominator
    const batchOutputWeight = new Map<string, number>();
    for (const item of productionItems) {
      const weight = item.goodParts * item.part.weightPerPiece;
      const recordId = item.productionRecordId;
      batchOutputWeight.set(recordId, (batchOutputWeight.get(recordId) ?? 0) + weight);
    }

    interface PartRollup {
      batches: Set<string>;
      quantityProduced: number;
      goodParts: number;
      rejectedParts: number;
      aluminumUsed: number;
      totalScrap: number;
      efficiencySum: number;
      efficiencyCount: number;
    }
    const rollupByPart = new Map<string, PartRollup>();

    for (const item of productionItems) {
      const current: PartRollup = rollupByPart.get(item.partId) ?? {
        batches: new Set(),
        quantityProduced: 0,
        goodParts: 0,
        rejectedParts: 0,
        aluminumUsed: 0,
        totalScrap: 0,
        efficiencySum: 0,
        efficiencyCount: 0,
      };

      const batchWeight = batchOutputWeight.get(item.productionRecordId) ?? 0;
      const itemWeight = item.goodParts * item.part.weightPerPiece;
      // Fall back to an equal split when a batch produced no good parts
      const share = batchWeight > 0 ? itemWeight / batchWeight : 0;

      current.batches.add(item.productionRecordId);
      current.quantityProduced += item.quantityProduced;
      current.goodParts += item.goodParts;
      current.rejectedParts += item.rejectedParts;
      current.aluminumUsed += item.productionRecord.aluminumUsed * share;
      current.totalScrap += item.productionRecord.totalScrap * share;
      current.efficiencySum += item.productionRecord.efficiency;
      current.efficiencyCount += 1;

      rollupByPart.set(item.partId, current);
    }

    const partAnalytics = activeParts.map((part) => {
      const agg = rollupByPart.get(part.id);
      const produced = agg?.quantityProduced ?? 0;
      const rejected = agg?.rejectedParts ?? 0;

      return {
        id: part.id,
        partCode: part.partCode,
        name: part.name,
        weightPerPiece: part.weightPerPiece,
        expectedScrap: part.expectedScrap,
        batches: agg?.batches.size ?? 0,
        quantityProduced: produced,
        goodParts: agg?.goodParts ?? 0,
        rejectedParts: rejected,
        aluminumUsed: agg?.aluminumUsed ?? 0,
        totalScrap: agg?.totalScrap ?? 0,
        avgEfficiency:
          agg && agg.efficiencyCount > 0 ? agg.efficiencySum / agg.efficiencyCount : 0,
        rejectionRate: produced > 0 ? (rejected / produced) * 100 : 0,
      };
    });

    // ---- Fettling shop -------------------------------------------------
    // Activity types are admin-managed rows, so the list is read from the table
    const activityTypes = await prisma.activityType.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    });

    const activeEmployees = await prisma.employee.count({ where: { isActive: true } });

    const employeesByActivity = await prisma.employee.groupBy({
      by: ["activityTypeId"],
      where: { isActive: true },
      _count: { _all: true },
    });
    const headcountByActivity = new Map(
      employeesByActivity.map((row) => [row.activityTypeId, row._count._all])
    );

    // The activity date column is a DATE, so anchor "today" at UTC midnight to
    // match how entries are stored.
    const todayDateOnly = new Date(
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
    );
    const monthStartDateOnly = new Date(
      Date.UTC(monthStart.getFullYear(), monthStart.getMonth(), 1)
    );

    const [fettlingToday, fettlingMonth] = await Promise.all([
      prisma.fettlingActivity.groupBy({
        by: ["activityTypeId"],
        where: { date: todayDateOnly },
        _sum: { partsCompleted: true },
        _count: { _all: true },
      }),
      prisma.fettlingActivity.groupBy({
        by: ["activityTypeId"],
        where: { date: { gte: monthStartDateOnly } },
        _sum: { partsCompleted: true },
        _count: { _all: true },
      }),
    ]);

    const todayByActivity = new Map(fettlingToday.map((r) => [r.activityTypeId, r]));
    const monthByActivity = new Map(fettlingMonth.map((r) => [r.activityTypeId, r]));

    const fettlingByActivity = activityTypes.map((type) => ({
      activityTypeId: type.id,
      name: type.name,
      employees: headcountByActivity.get(type.id) ?? 0,
      todayParts: todayByActivity.get(type.id)?._sum.partsCompleted ?? 0,
      todayEntries: todayByActivity.get(type.id)?._count._all ?? 0,
      monthParts: monthByActivity.get(type.id)?._sum.partsCompleted ?? 0,
      monthEntries: monthByActivity.get(type.id)?._count._all ?? 0,
    }));

    // Top performers this month
    const topEmployeesRaw = await prisma.fettlingActivity.groupBy({
      by: ["employeeId"],
      where: { date: { gte: monthStartDateOnly } },
      _sum: { partsCompleted: true },
      _count: { _all: true },
      orderBy: { _sum: { partsCompleted: "desc" } },
      take: 5,
    });

    const topEmployeeRecords = await prisma.employee.findMany({
      where: { id: { in: topEmployeesRaw.map((r) => r.employeeId) } },
      select: {
        id: true,
        name: true,
        employeeCode: true,
        activityType: { select: { name: true } },
      },
    });
    const employeeById = new Map(topEmployeeRecords.map((e) => [e.id, e]));

    const topEmployees = topEmployeesRaw.map((row) => ({
      employeeId: row.employeeId,
      name: employeeById.get(row.employeeId)?.name ?? "Unknown",
      employeeCode: employeeById.get(row.employeeId)?.employeeCode ?? "-",
      activityName: employeeById.get(row.employeeId)?.activityType.name ?? null,
      parts: row._sum.partsCompleted ?? 0,
      entries: row._count._all,
    }));

    // Companies count
    const companiesCount = await prisma.company.count({ where: { isActive: true } });

    // Suppliers count
    const suppliersCount = await prisma.supplier.count({ where: { isActive: true } });

    const dashboardData = {
      inventory: {
        ingot: ingotStock,
        // Per-grade stock, always all three rows so an empty grade still shows
        ingotByGrade,
        runnerRaiser: runnerRaiserStock,
        spillage: spillageStock,
        rejectedPart: rejectedPartStock,
        // All recyclable scrap types combined
        totalScrap,
        // The same scrap, cut by alloy instead of by form
        scrapByGrade,
        total: totalAluminum,
      },
      production: {
        today: {
          parts: todayProduction._sum.goodParts || 0,
          batches: todayProduction._count,
          aluminumUsed: todayProduction._sum.aluminumUsed || 0,
          aluminumByGrade: ingotSplit({
            INGOT_LM6: todayProduction._sum.aluminumUsedLM6 || 0,
            INGOT_LM9: todayProduction._sum.aluminumUsedLM9 || 0,
            INGOT_LM25: todayProduction._sum.aluminumUsedLM25 || 0,
          }),
          scrapGenerated: todayProduction._sum.totalScrap || 0,
        },
        month: {
          parts: monthProduction._sum.goodParts || 0,
          rejectedParts: monthProduction._sum.rejectedParts || 0,
          batches: monthProduction._count,
          aluminumUsed: monthProduction._sum.aluminumUsed || 0,
          aluminumByGrade: ingotSplit({
            INGOT_LM6: monthProduction._sum.aluminumUsedLM6 || 0,
            INGOT_LM9: monthProduction._sum.aluminumUsedLM9 || 0,
            INGOT_LM25: monthProduction._sum.aluminumUsedLM25 || 0,
          }),
          scrapGenerated: monthProduction._sum.totalScrap || 0,
          avgEfficiency: monthProduction._avg.efficiency || 0,
        },
      },
      orders: {
        pending: pendingOrders,
      },
      parts: partAnalytics,
      fettling: {
        activeEmployees,
        todayParts: fettlingByActivity.reduce((sum, o) => sum + o.todayParts, 0),
        monthParts: fettlingByActivity.reduce((sum, o) => sum + o.monthParts, 0),
        byActivity: fettlingByActivity,
        topEmployees,
      },
      counts: {
        parts: partsCount,
        companies: companiesCount,
        suppliers: suppliersCount,
      },
      alerts: {
        lowStock: lowStockItems.map((item) => ({
          type: item.type,
          quantity: item.quantity,
          threshold: lowStockThreshold,
        })),
      },
      recent: {
        production: recentProduction,
        orders: recentOrders,
        logs: recentLogs,
      },
    };

    return NextResponse.json({ success: true, data: dashboardData });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}
