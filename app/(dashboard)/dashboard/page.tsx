"use client";

import * as React from "react";
import {
  Package,
  Recycle,
  Factory,
  TrendingUp,
  ShoppingCart,
  Building2,
  Boxes,
  Layers,
  HardHat,
  ClipboardList,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatWeight, formatCurrency, formatDate } from "@/lib/utils";
import { materialLabel, type IngotSlice } from "@/lib/ingot";
import type { AluminumType } from "@/types";

interface DashboardData {
  inventory: {
    ingot: number;
    /** LM6 / LM9 / LM25, always all three even when a grade is at zero. */
    ingotByGrade: IngotSlice[];
    /** The same three grades, summed across every scrap form. */
    scrapByGrade: IngotSlice[];
    runnerRaiser: number;
    spillage: number;
    rejectedPart: number;
    totalScrap: number;
    total: number;
  };
  production: {
    today: {
      parts: number;
      batches: number;
      aluminumUsed: number;
      aluminumByGrade: IngotSlice[];
      scrapGenerated: number;
    };
    month: {
      parts: number;
      rejectedParts: number;
      batches: number;
      aluminumUsed: number;
      aluminumByGrade: IngotSlice[];
      scrapGenerated: number;
      avgEfficiency: number;
    };
  };
  orders: {
    pending: number;
  };
  fettling: {
    activeEmployees: number;
    todayParts: number;
    monthParts: number;
    byActivity: Array<{
      activityTypeId: string;
      name: string;
      employees: number;
      todayParts: number;
      todayEntries: number;
      monthParts: number;
      monthEntries: number;
    }>;
    topEmployees: Array<{
      employeeId: string;
      name: string;
      employeeCode: string;
      activityName: string | null;
      parts: number;
      entries: number;
    }>;
  };
  parts: Array<{
    id: string;
    partCode: string;
    name: string;
    weightPerPiece: number;
    /** Metal poured per casting; null where it has not been recorded. */
    pouringWeight: number | null;
    /** Gating per casting, derived from the weights; null when unknown. */
    expectedScrap: number | null;
    batches: number;
    quantityProduced: number;
    goodParts: number;
    rejectedParts: number;
    aluminumUsed: number;
    totalScrap: number;
    avgEfficiency: number;
    rejectionRate: number;
    alloyGrade: string;
    /** Rejected at the furnace, and at the fettling bench. */
    castingRejects: number;
    fettlingRejects: number;
    fettlingHandled: number;
    /** What those rejects weigh, at this part's own weight per piece. */
    rejectedWeight: number;
  }>;
  counts: {
    parts: number;
    companies: number;
    suppliers: number;
  };
  alerts: {
    lowStock: Array<{
      type: AluminumType;
      quantity: number;
      threshold: number;
    }>;
  };
  recent: {
    production: Array<{
      id: string;
      batchNumber: string;
      goodParts: number;
      efficiency: number;
      date: string;
      items: Array<{
        id: string;
        part: { name: string; partCode: string };
      }>;
    }>;
    orders: Array<{
      id: string;
      poNumber: string;
      quantity: number;
      status: string;
      expectedDate: string | null;
      supplier: { name: string };
    }>;
  };
}

export default function DashboardPage() {
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<Date>(new Date());

  const fetchData = React.useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard");
      const result = await response.json();

      if (result.success) {
        setData(result.data);
        setLastUpdated(new Date());
        setError(null);
      } else {
        setError(result.error || "Failed to fetch dashboard data");
      }
    } catch (err) {
      console.error("Error fetching dashboard:", err);
      setError("Failed to fetch dashboard data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-[var(--muted-foreground)]">{error || "No data available"}</p>
        <Button onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  const totalAluminum = data.inventory.total;

  // Share of total aluminium held as raw ingot vs recyclable scrap
  const ingotShare = totalAluminum > 0 ? (data.inventory.ingot / totalAluminum) * 100 : 0;
  const scrapShare = totalAluminum > 0 ? (data.inventory.totalScrap / totalAluminum) * 100 : 0;

  const scrapTypes = [
    {
      label: "Runner & Raiser Scrap",
      value: data.inventory.runnerRaiser,
      iconClassName: "bg-blue-100",
    },
    {
      label: "Spillage Scrap",
      value: data.inventory.spillage,
      iconClassName: "bg-orange-100",
    },
    {
      label: "Rejected Part Scrap",
      value: data.inventory.rejectedPart,
      iconClassName: "bg-red-100",
    },
  ].map((scrap) => ({
    ...scrap,
    share: data.inventory.totalScrap > 0 ? (scrap.value / data.inventory.totalScrap) * 100 : 0,
  }));

  // All-time production rolled up across every active part
  const partTotals = data.parts.reduce(
    (acc, part) => ({
      batches: acc.batches + part.batches,
      quantityProduced: acc.quantityProduced + part.quantityProduced,
      goodParts: acc.goodParts + part.goodParts,
      rejectedParts: acc.rejectedParts + part.rejectedParts,
      aluminumUsed: acc.aluminumUsed + part.aluminumUsed,
      totalScrap: acc.totalScrap + part.totalScrap,
    }),
    {
      batches: 0,
      quantityProduced: 0,
      goodParts: 0,
      rejectedParts: 0,
      aluminumUsed: 0,
      totalScrap: 0,
    }
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Dashboard Overview
          </h1>
          <p className="text-[var(--muted-foreground)]">
            Monitor your aluminum inventory and production metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">System Online</Badge>
          <span className="text-sm text-[var(--muted-foreground)]">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </span>
          <Button variant="ghost" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Low Stock Alert */}
      {data.alerts.lowStock.length > 0 && (
        <div className="p-4 rounded-lg bg-[var(--warning-light)] border border-[var(--warning)] flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-[var(--warning)]" />
          <div>
            <p className="font-medium text-amber-800">Low Stock Alert</p>
            <p className="text-sm text-amber-700">
              {data.alerts.lowStock.map((alert, idx) => (
                <span key={alert.type}>
                  {idx > 0 && ", "}
                  {materialLabel(alert.type)} stock is below minimum level. Current:{" "}
                  {formatWeight(alert.quantity)}, Minimum: {formatWeight(alert.threshold)}
                </span>
              ))}
            </p>
          </div>
        </div>
      )}

      {/* ---------------------------------------------- Aluminium overview */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Boxes className="h-5 w-5 text-[var(--primary)]" />
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            Aluminium Stock Overview
          </h2>
        </div>

        {/* Headline totals: everything, then raw ingot, then all scrap */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title="Total Aluminium"
            value={formatWeight(data.inventory.total)}
            icon={Boxes}
            description="Ingot + all scrap types"
          />
          <StatCard
            title="Total Ingot Stock"
            value={formatWeight(data.inventory.ingot)}
            icon={Package}
            description={`${ingotShare.toFixed(1)}% of total aluminium`}
          />
          <StatCard
            title="Total Scrap"
            value={formatWeight(data.inventory.totalScrap)}
            icon={Recycle}
            iconClassName="bg-amber-100"
            description={`${scrapShare.toFixed(1)}% of total aluminium`}
          />
        </div>

        {/* Ingot split by grade - the alloys are not interchangeable metal */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
            Ingot by grade
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data.inventory.ingotByGrade.map((grade) => (
              <StatCard
                key={grade.type}
                title={grade.label}
                value={formatWeight(grade.quantity)}
                icon={Package}
                iconClassName={grade.iconClass}
                description={
                  grade.quantity > 0
                    ? `${grade.percentage.toFixed(1)}% of ingot · ${grade.description}`
                    : `No stock · ${grade.description}`
                }
              />
            ))}
          </div>
        </div>

        {/* Scrap split by type */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
            Scrap by type
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {scrapTypes.map((scrap) => (
              <StatCard
                key={scrap.label}
                title={scrap.label}
                value={formatWeight(scrap.value)}
                icon={Recycle}
                iconClassName={scrap.iconClassName}
                description={`${scrap.share.toFixed(1)}% of total scrap`}
              />
            ))}
          </div>

          {/* The same scrap cut the other way. Scrap carries the grade of the
              heat it came off, so this is what may actually be re-melted into
              each alloy - the figure above says nothing about that. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--muted-foreground)]">
              Of which:
            </span>
            {data.inventory.scrapByGrade.map((grade) => (
              <span
                key={grade.grade}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs"
              >
                <span className={`h-2 w-2 rounded-full ${grade.dotClass}`} />
                <span className="font-medium">{grade.grade}</span>
                <span className="text-[var(--muted-foreground)]">
                  {formatWeight(grade.quantity)}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ Parts analytics */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-[var(--primary)]" />
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            Parts Analytics
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Parts"
            value={data.counts.parts}
            icon={Layers}
            description="Active part numbers"
          />
          <StatCard
            title="Total Produced"
            value={partTotals.quantityProduced.toLocaleString("en-IN")}
            icon={Factory}
            description={`${partTotals.batches} batches all time`}
          />
          <StatCard
            title="Good Parts"
            value={partTotals.goodParts.toLocaleString("en-IN")}
            icon={TrendingUp}
            iconClassName="bg-green-100"
            description={`${partTotals.rejectedParts.toLocaleString("en-IN")} rejected`}
          />
          <StatCard
            title="Aluminium Consumed"
            value={formatWeight(partTotals.aluminumUsed)}
            icon={Boxes}
            description={`${formatWeight(partTotals.totalScrap)} scrap generated`}
          />
        </div>

        {/* Per part-number breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-[var(--primary)]" />
              Breakdown by Part Number
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.parts.length === 0 ? (
              <div className="text-center py-8 text-[var(--muted-foreground)]">
                No active parts
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="text-left py-3 px-4 font-semibold text-sm">Part Number</th>
                      <th className="text-left py-3 px-4 font-semibold text-sm">Part Name</th>
                      <th className="text-right py-3 px-4 font-semibold text-sm">Weight / pc</th>
                      <th className="text-left py-3 px-4 font-semibold text-sm">Alloy</th>
                      <th className="text-right py-3 px-4 font-semibold text-sm">Batches</th>
                      <th className="text-right py-3 px-4 font-semibold text-sm">Produced</th>
                      <th className="text-right py-3 px-4 font-semibold text-sm">Good</th>
                      <th className="text-right py-3 px-4 font-semibold text-sm">Rejected</th>
                      <th className="text-right py-3 px-4 font-semibold text-sm">Aluminium Used</th>
                      <th className="text-right py-3 px-4 font-semibold text-sm">Scrap</th>
                      <th className="text-right py-3 px-4 font-semibold text-sm">Efficiency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.parts.map((part) => (
                      <tr
                        key={part.id}
                        className="border-b border-[var(--border)] hover:bg-[var(--muted)]"
                      >
                        <td className="py-3 px-4">
                          <span className="font-mono text-sm bg-[var(--muted)] px-2 py-1 rounded">
                            {part.partCode}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-medium">{part.name}</td>
                        <td className="py-3 px-4 text-right text-sm">
                          {formatWeight(part.weightPerPiece)}
                        </td>
                        <td className="py-3 px-4 text-sm">{part.alloyGrade}</td>
                        <td className="py-3 px-4 text-right text-sm">{part.batches}</td>
                        <td className="py-3 px-4 text-right font-medium">
                          {part.quantityProduced.toLocaleString("en-IN")}
                        </td>
                        <td className="py-3 px-4 text-right text-sm text-green-700">
                          {part.goodParts.toLocaleString("en-IN")}
                        </td>
                        <td className="py-3 px-4 text-right text-sm">
                          <span className={part.rejectedParts > 0 ? "text-red-600" : ""}>
                            {part.rejectedParts.toLocaleString("en-IN")}
                          </span>
                          {part.rejectionRate > 0 && (
                            <span className="text-[var(--muted-foreground)] ml-1">
                              ({part.rejectionRate.toFixed(1)}%)
                            </span>
                          )}
                          {/* Where it failed matters more than the total: at
                              the furnace is a melt problem, at the bench is a
                              finishing one */}
                          {part.rejectedParts > 0 && (
                            <span className="block text-xs text-[var(--muted-foreground)]">
                              {part.castingRejects} casting &middot;{" "}
                              {part.fettlingRejects} fettling &middot;{" "}
                              {formatWeight(part.rejectedWeight)}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-sm">
                          {formatWeight(part.aluminumUsed)}
                        </td>
                        <td className="py-3 px-4 text-right text-sm">
                          {formatWeight(part.totalScrap)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {part.batches > 0 ? (
                            <Badge
                              variant={
                                part.avgEfficiency >= 85
                                  ? "success"
                                  : part.avgEfficiency >= 70
                                  ? "warning"
                                  : "error"
                              }
                            >
                              {part.avgEfficiency.toFixed(1)}%
                            </Badge>
                          ) : (
                            <span className="text-[var(--muted-foreground)] text-sm">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------------------------------------------- Fettling shop */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <HardHat className="h-5 w-5 text-[var(--primary)]" />
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            Fettling Shop
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title="Active Employees"
            value={data.fettling.activeEmployees}
            icon={HardHat}
            description="on the shop floor"
          />
          <StatCard
            title="Parts Fettled Today"
            value={data.fettling.todayParts.toLocaleString("en-IN")}
            icon={ClipboardList}
            description="across all operations"
          />
          <StatCard
            title="Parts Fettled This Month"
            value={data.fettling.monthParts.toLocaleString("en-IN")}
            icon={ClipboardList}
            description="month to date"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Operation breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-[var(--primary)]" />
                Output by Operation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="text-left py-2 px-3 font-semibold text-sm">Operation</th>
                      <th className="text-right py-2 px-3 font-semibold text-sm">Staff</th>
                      <th className="text-right py-2 px-3 font-semibold text-sm">Today</th>
                      <th className="text-right py-2 px-3 font-semibold text-sm">This Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.fettling.byActivity.map((op) => (
                      <tr
                        key={op.activityTypeId}
                        className="border-b border-[var(--border)] hover:bg-[var(--muted)]"
                      >
                        <td className="py-2.5 px-3 font-medium text-sm">
                          {op.name}
                        </td>
                        <td className="py-2.5 px-3 text-right text-sm">{op.employees}</td>
                        <td className="py-2.5 px-3 text-right font-medium">
                          {op.todayParts.toLocaleString("en-IN")}
                        </td>
                        <td className="py-2.5 px-3 text-right text-sm text-[var(--muted-foreground)]">
                          {op.monthParts.toLocaleString("en-IN")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Top employees this month */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardHat className="h-5 w-5 text-[var(--primary)]" />
                Top Employees This Month
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.fettling.topEmployees.length === 0 ? (
                <div className="text-center py-8 text-[var(--muted-foreground)]">
                  No fettling activity recorded this month
                </div>
              ) : (
                <div className="space-y-4">
                  {data.fettling.topEmployees.map((employee) => {
                    const top = data.fettling.topEmployees[0].parts || 1;
                    return (
                      <div key={employee.employeeId} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span>
                            <span className="font-mono text-xs bg-[var(--muted)] px-1.5 py-0.5 rounded mr-2">
                              {employee.employeeCode}
                            </span>
                            <span className="font-medium">{employee.name}</span>
                            {employee.activityName && (
                              <span className="text-[var(--muted-foreground)] ml-2">
                                {employee.activityName}
                              </span>
                            )}
                          </span>
                          <span className="font-medium">
                            {employee.parts.toLocaleString("en-IN")}
                          </span>
                        </div>
                        <div className="h-2 bg-[var(--muted)] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[var(--primary)] rounded-full transition-all duration-500"
                            style={{ width: `${(employee.parts / top) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* --------------------------------------------- Production & orders */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Today's Production"
          value={`${data.production.today.parts} parts`}
          icon={Factory}
          description={`${data.production.today.batches} batches`}
        />
        <StatCard
          title="Avg. Efficiency"
          value={`${data.production.month.avgEfficiency.toFixed(1)}%`}
          icon={TrendingUp}
          description="This month"
        />
        <StatCard
          title="Pending Orders"
          value={data.orders.pending}
          icon={ShoppingCart}
          description="Purchase orders"
        />
      </div>

      {/* Charts & Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inventory Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-[var(--primary)]" />
              Inventory Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                // Each ingot grade gets its own bar - rolling them into one
                // "Ingot" row would hide which alloy the stock actually is
                ...data.inventory.ingotByGrade.map((grade) => ({
                  label: grade.label,
                  value: grade.quantity,
                  color: grade.dotClass,
                })),
                {
                  label: "Runner & Raiser",
                  value: data.inventory.runnerRaiser,
                  color: "bg-blue-500",
                },
                {
                  label: "Spillage",
                  value: data.inventory.spillage,
                  color: "bg-orange-500",
                },
                {
                  label: "Rejected Parts",
                  value: data.inventory.rejectedPart,
                  color: "bg-red-500",
                },
              ].map((item) => (
                <div key={item.label} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--foreground)]">{item.label}</span>
                    <span className="font-medium">{formatWeight(item.value)}</span>
                  </div>
                  <div className="h-2 bg-[var(--muted)] rounded-full overflow-hidden">
                    <div
                      className={`h-full ${item.color} rounded-full transition-all duration-500`}
                      style={{
                        width: totalAluminum > 0 ? `${(item.value / totalAluminum) * 100}%` : "0%",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Production */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Factory className="h-5 w-5 text-[var(--primary)]" />
              Recent Production
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.recent.production.length === 0 ? (
              <div className="text-center py-8 text-[var(--muted-foreground)]">
                No recent production records
              </div>
            ) : (
              <div className="space-y-4">
                {data.recent.production.map((production) => (
                  <div
                    key={production.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--muted)] hover:bg-[var(--accent)] transition-colors"
                  >
                    <div>
                      <p className="flex items-center gap-2 font-medium text-[var(--foreground)]">
                        <span>{production.items[0]?.part.name ?? "-"}</span>
                        {production.items.length > 1 && (
                          <span
                            className="rounded-full bg-[var(--background)] px-2 py-0.5 text-xs font-medium text-[var(--muted-foreground)]"
                            title={production.items
                              .slice(1)
                              .map((i) => i.part.name)
                              .join(", ")}
                          >
                            +{production.items.length - 1}
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        {production.batchNumber} • {production.goodParts} parts
                      </p>
                    </div>
                    <Badge
                      variant={production.efficiency >= 90 ? "success" : "warning"}
                    >
                      {production.efficiency.toFixed(1)}% eff.
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pending Purchase Orders */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-[var(--primary)]" />
            Recent Purchase Orders
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.recent.orders.length === 0 ? (
            <div className="text-center py-8 text-[var(--muted-foreground)]">
              No recent purchase orders
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      PO Number
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Supplier
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Quantity
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Expected Date
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.orders.map((po) => (
                    <tr
                      key={po.id}
                      className="border-b border-[var(--border)] hover:bg-[var(--muted)]"
                    >
                      <td className="py-3 px-4 font-medium">{po.poNumber}</td>
                      <td className="py-3 px-4">{po.supplier.name}</td>
                      <td className="py-3 px-4">{formatWeight(po.quantity)}</td>
                      <td className="py-3 px-4">
                        {po.expectedDate ? formatDate(new Date(po.expectedDate)) : "-"}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={
                            po.status === "DELIVERED"
                              ? "success"
                              : po.status === "IN_TRANSIT"
                              ? "info"
                              : "warning"
                          }
                        >
                          {po.status.replace("_", " ")}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Stats Footer */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-lg bg-[var(--card)] border border-[var(--border)] text-center">
          <Building2 className="h-6 w-6 mx-auto mb-2 text-[var(--primary)]" />
          <p className="text-2xl font-bold">{data.counts.companies}</p>
          <p className="text-sm text-[var(--muted-foreground)]">Active Companies</p>
        </div>
        <div className="p-4 rounded-lg bg-[var(--card)] border border-[var(--border)] text-center">
          <Boxes className="h-6 w-6 mx-auto mb-2 text-[var(--primary)]" />
          <p className="text-2xl font-bold">{data.counts.parts}</p>
          <p className="text-sm text-[var(--muted-foreground)]">Active Parts</p>
        </div>
        <div className="p-4 rounded-lg bg-[var(--card)] border border-[var(--border)] text-center">
          <Factory className="h-6 w-6 mx-auto mb-2 text-[var(--primary)]" />
          <p className="text-2xl font-bold">{data.production.month.batches}</p>
          <p className="text-sm text-[var(--muted-foreground)]">Batches This Month</p>
        </div>
        <div className="p-4 rounded-lg bg-[var(--card)] border border-[var(--border)] text-center">
          <TrendingUp className="h-6 w-6 mx-auto mb-2 text-[var(--primary)]" />
          <p className="text-2xl font-bold">{data.counts.suppliers}</p>
          <p className="text-sm text-[var(--muted-foreground)]">Suppliers</p>
        </div>
      </div>
    </div>
  );
}
