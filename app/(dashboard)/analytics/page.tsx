"use client";

import * as React from "react";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Download,
  RefreshCw,
  Package,
  Factory,
  Recycle,
  DollarSign,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { formatWeight, formatCurrency } from "@/lib/utils";
import { weightForExport } from "@/lib/units";
import type { IngotSlice } from "@/lib/ingot";
import {
  exportToExcel,
  timestampedFilename,
  sheet,
} from "@/lib/export-excel";

interface AnalyticsData {
  summary: {
    totalProduction: number;
    totalScrap: number;
    /** Ingot charged into the furnace over the period, all grades together. */
    totalIngotCharged: number;
    avgEfficiency: number;
    totalPurchases: number;
    purchaseValue: number;
  };
  trends: {
    production: number;
    efficiency: number;
    scrapRate: number;
    purchases: number;
  };
  efficiencyTrend: Array<{ date: string; efficiency: number }>;
  productionByPart: Array<{ part: string; quantity: number; percentage: number }>;
  scrapBreakdown: Array<{ type: string; quantity: number; percentage: number; color: string }>;
  /** Ingot charged over the period, split LM6 / LM9 / LM25. */
  ingotBreakdown: IngotSlice[];
  /** Ingot currently in stock, split the same way. */
  ingotStockByGrade: IngotSlice[];
  inventoryTrend: Array<{ date: string; ingot: number; scrap: number }>;
  topClients: Array<{ name: string; dispatched: number; orders: number }>;
}

export default function AnalyticsPage() {
  const [dateRange, setDateRange] = React.useState("30d");
  const [isLoading, setIsLoading] = React.useState(true);
  const [data, setData] = React.useState<AnalyticsData | null>(null);
  const [isExporting, setIsExporting] = React.useState(false);

  const handleExport = async () => {
    if (!data) return;
    setIsExporting(true);
    try {
      // The analytics page holds aggregates, so each block becomes its own sheet
      const summaryRows = [
        { metric: "Total Production (parts)", value: data.summary.totalProduction },
        { metric: "Total Scrap (kg)", value: weightForExport(data.summary.totalScrap) },
        {
          metric: "Total Ingot Charged (kg)",
          value: weightForExport(data.summary.totalIngotCharged),
        },
        { metric: "Average Efficiency (%)", value: Number(data.summary.avgEfficiency.toFixed(2)) },
        { metric: "Total Purchases (kg)", value: weightForExport(data.summary.totalPurchases) },
        { metric: "Purchase Value (INR)", value: data.summary.purchaseValue },
        { metric: "Production Trend (%)", value: data.trends.production },
        { metric: "Efficiency Trend (%)", value: data.trends.efficiency },
        { metric: "Scrap Rate Trend (%)", value: data.trends.scrapRate },
        { metric: "Purchases Trend (%)", value: data.trends.purchases },
      ];

      await exportToExcel(timestampedFilename(`analytics-${dateRange}`), [
        sheet<{ metric: string; value: number }>({
          name: "Summary",
          rows: summaryRows,
          columns: [
            { header: "Metric", value: (r) => r.metric, width: 30 },
            { header: "Value", value: (r) => r.value, width: 18 },
          ],
        }),
        sheet<AnalyticsData["efficiencyTrend"][number]>({
          name: "Efficiency Trend",
          rows: data.efficiencyTrend,
          columns: [
            { header: "Period", value: (r) => r.date, width: 16 },
            {
              header: "Efficiency (%)",
              value: (r) => Number(r.efficiency.toFixed(2)),
              width: 16,
            },
          ],
        }),
        sheet<AnalyticsData["productionByPart"][number]>({
          name: "Production by Part",
          rows: data.productionByPart,
          columns: [
            { header: "Part", value: (r) => r.part, width: 32 },
            { header: "Quantity", value: (r) => r.quantity, width: 14 },
            {
              header: "Share (%)",
              value: (r) => Number(r.percentage.toFixed(2)),
              width: 14,
            },
          ],
        }),
        sheet<AnalyticsData["scrapBreakdown"][number]>({
          name: "Scrap Breakdown",
          rows: data.scrapBreakdown,
          columns: [
            { header: "Scrap Type", value: (r) => r.type, width: 26 },
            { header: "Quantity (kg)", value: (r) => weightForExport(r.quantity), width: 16 },
            {
              header: "Share (%)",
              value: (r) => Number(r.percentage.toFixed(2)),
              width: 14,
            },
          ],
        }),
        sheet<IngotSlice>({
          name: "Ingot by Grade",
          rows: data.ingotBreakdown,
          columns: [
            { header: "Grade", value: (r) => r.grade, width: 12 },
            { header: "Alloy", value: (r) => r.description, width: 30 },
            { header: "Charged (kg)", value: (r) => weightForExport(r.quantity), width: 16 },
            {
              header: "Share of Charge (%)",
              value: (r) => Number(r.percentage.toFixed(2)),
              width: 20,
            },
            {
              header: "In Stock (kg)",
              value: (r) =>
                weightForExport(
                  data.ingotStockByGrade.find((s) => s.type === r.type)?.quantity ?? 0
                ),
              width: 16,
            },
          ],
        }),
        sheet<AnalyticsData["inventoryTrend"][number]>({
          name: "Inventory Trend",
          rows: data.inventoryTrend,
          columns: [
            { header: "Period", value: (r) => r.date, width: 16 },
            { header: "Ingot (kg)", value: (r) => weightForExport(r.ingot), width: 16 },
            { header: "Scrap (kg)", value: (r) => weightForExport(r.scrap), width: 16 },
          ],
        }),
        sheet<AnalyticsData["topClients"][number]>({
          name: "Top Clients",
          rows: data.topClients,
          columns: [
            { header: "Client", value: (r) => r.name, width: 30 },
            { header: "Dispatched (kg)", value: (r) => weightForExport(r.dispatched), width: 16 },
            { header: "Orders", value: (r) => r.orders, width: 12 },
          ],
        }),
      ]);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setIsExporting(false);
    }
  };

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/analytics?range=${dateRange}&t=${Date.now()}`);
      const result = await response.json();
      if (result.success) {
        setData(result.data);
      }
    } catch (error) {
      console.error("Error fetching analytics:", error);
    } finally {
      setIsLoading(false);
    }
  }, [dateRange]);

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

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-[var(--muted-foreground)]">Failed to load analytics data</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Analytics & Reports
          </h1>
          <p className="text-[var(--muted-foreground)]">
            Comprehensive insights into production, inventory, and efficiency
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-44 shrink-0">
            <Select
              options={[
                { value: "7d", label: "Last 7 days" },
                { value: "30d", label: "Last 30 days" },
                { value: "90d", label: "Last 90 days" },
                { value: "1y", label: "Last year" },
              ]}
              value={dateRange}
              onChange={setDateRange}
            />
          </div>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            isLoading={isExporting}
            disabled={!data}
          >
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Production"
          value={`${data.summary.totalProduction} parts`}
          icon={Factory}
          trend={
            data.trends.production !== 0
              ? {
                  value: data.trends.production,
                  isPositive: data.trends.production > 0,
                }
              : undefined
          }
        />
        <StatCard
          title="Average Efficiency"
          value={`${data.summary.avgEfficiency}%`}
          icon={TrendingUp}
          trend={
            data.trends.efficiency !== 0
              ? {
                  value: data.trends.efficiency,
                  isPositive: data.trends.efficiency > 0,
                }
              : undefined
          }
        />
        <StatCard
          title="Total Scrap Generated"
          value={formatWeight(data.summary.totalScrap)}
          icon={Recycle}
          trend={
            data.trends.scrapRate !== 0
              ? {
                  value: Math.abs(data.trends.scrapRate),
                  isPositive: data.trends.scrapRate < 0,
                }
              : undefined
          }
        />
        <StatCard
          title="Purchase Value"
          value={formatCurrency(data.summary.purchaseValue)}
          icon={DollarSign}
          trend={
            data.trends.purchases !== 0
              ? {
                  value: data.trends.purchases,
                  isPositive: true,
                }
              : undefined
          }
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inventory Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-[var(--primary)]" />
              Current Inventory
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Legend */}
              <div className="flex items-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-[var(--primary)]" />
                  <span>Ingot Stock</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-blue-500" />
                  <span>Total Scrap</span>
                </div>
              </div>

              {/* Simple Bar Chart */}
              <div className="space-y-3">
                {data.inventoryTrend.length > 0 ? (
                  data.inventoryTrend.map((item) => (
                    <div key={item.date} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[var(--muted-foreground)]">
                          {item.date}
                        </span>
                        <span className="font-medium">
                          {formatWeight(item.ingot)}
                        </span>
                      </div>
                      <div className="flex gap-1 h-6">
                        <div
                          className="bg-[var(--primary)] rounded"
                          style={{
                            width: `${Math.min((item.ingot / (item.ingot + item.scrap + 1)) * 100, 100)}%`,
                          }}
                        />
                        <div
                          className="bg-blue-500 rounded"
                          style={{
                            width: `${Math.min((item.scrap / (item.ingot + item.scrap + 1)) * 100, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-[var(--muted-foreground)]">
                    No inventory data available
                  </div>
                )}
              </div>

              {/* The ingot bar above is three alloys stacked together, so the
                  grades are listed out underneath it */}
              <div className="pt-3 border-t border-[var(--border)] space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  Ingot by grade
                </p>
                {data.ingotStockByGrade.map((grade) => (
                  <div
                    key={grade.type}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded ${grade.dotClass}`} />
                      <span>{grade.grade}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {grade.description}
                      </span>
                    </div>
                    <span className="font-medium">{formatWeight(grade.quantity)}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Production by Part */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Factory className="h-5 w-5 text-[var(--primary)]" />
              Production by Part
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.productionByPart.length > 0 ? (
                data.productionByPart.map((item, index) => (
                  <div key={item.part} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{item.part}</span>
                      <span className="text-[var(--muted-foreground)]">
                        {item.quantity} parts ({item.percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-3 bg-[var(--muted)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${item.percentage}%`,
                          background: `hsl(${40 + index * 15}, 70%, 50%)`,
                        }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-[var(--muted-foreground)]">
                  No production data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Metal in, metal out: which alloys were charged, and what came back
          as scrap. Side by side because they are two halves of one balance. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ingot charged, split by grade */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-[var(--primary)]" />
              Ingot Charged by Grade
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.summary.totalIngotCharged > 0 ? (
                <>
                  <div className="relative w-48 h-48 mx-auto">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 160 160">
                      {data.ingotBreakdown.reduce(
                        (acc, item) => {
                          const circumference = 2 * Math.PI * 55;
                          const strokeDasharray = `${(item.percentage / 100) * circumference} ${circumference}`;

                          acc.elements.push(
                            <circle
                              key={item.type}
                              cx="80"
                              cy="80"
                              r="55"
                              fill="none"
                              stroke={item.hex}
                              strokeWidth="16"
                              strokeDasharray={strokeDasharray}
                              strokeDashoffset={-acc.offset}
                            />
                          );
                          acc.offset += (item.percentage / 100) * circumference;
                          return acc;
                        },
                        { elements: [] as React.ReactNode[], offset: 0 }
                      ).elements}
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center px-2">
                        <p className="text-sm font-bold leading-tight">
                          {formatWeight(data.summary.totalIngotCharged)}
                        </p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          Charged
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Legend - charged over the period, and what is left in stock */}
                  <div className="space-y-2">
                    {data.ingotBreakdown.map((item) => {
                      const inStock =
                        data.ingotStockByGrade.find((s) => s.type === item.type)?.quantity ?? 0;
                      return (
                        <div
                          key={item.type}
                          className="flex items-center justify-between text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded ${item.dotClass}`} />
                            <span>{item.grade}</span>
                            <span className="text-xs text-[var(--muted-foreground)]">
                              {item.percentage.toFixed(1)}%
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="font-medium">{formatWeight(item.quantity)}</span>
                            <span className="block text-xs text-[var(--muted-foreground)]">
                              {formatWeight(inStock)} in stock
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-[var(--muted-foreground)]">
                  No ingot charged in this period
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Scrap Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Recycle className="h-5 w-5 text-[var(--primary)]" />
              Scrap Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Donut Chart */}
              {data.summary.totalScrap > 0 ? (
                <>
                  <div className="relative w-48 h-48 mx-auto">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 160 160">
                      {data.scrapBreakdown.reduce(
                        (acc, item, index) => {
                          const circumference = 2 * Math.PI * 55;
                          const strokeDasharray = `${(item.percentage / 100) * circumference} ${circumference}`;
                          const colors = ["#3B82F6", "#F97316", "#EF4444"];

                          acc.elements.push(
                            <circle
                              key={item.type}
                              cx="80"
                              cy="80"
                              r="55"
                              fill="none"
                              stroke={colors[index]}
                              strokeWidth="16"
                              strokeDasharray={strokeDasharray}
                              strokeDashoffset={-acc.offset}
                            />
                          );
                          acc.offset += (item.percentage / 100) * circumference;
                          return acc;
                        },
                        { elements: [] as React.ReactNode[], offset: 0 }
                      ).elements}
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center px-2">
                        <p className="text-sm font-bold leading-tight">
                          {formatWeight(data.summary.totalScrap)}
                        </p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          Total
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Legend */}
                  <div className="space-y-2">
                    {data.scrapBreakdown.map((item) => (
                      <div
                        key={item.type}
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded ${item.color}`} />
                          <span>{item.type}</span>
                        </div>
                        <span className="font-medium">
                          {formatWeight(item.quantity)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-[var(--muted-foreground)]">
                  No scrap data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Efficiency Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[var(--primary)]" />
              Efficiency Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.efficiencyTrend.length > 0 ? (
                <>
                  {/* Bar Chart with values */}
                  <div className="relative">
                    {/* Y-axis labels */}
                    <div className="absolute left-0 top-0 bottom-6 w-10 flex flex-col justify-between text-xs text-[var(--muted-foreground)]">
                      <span>100%</span>
                      <span>75%</span>
                      <span>50%</span>
                      <span>25%</span>
                      <span>0%</span>
                    </div>

                    {/* Chart area */}
                    <div className="ml-12">
                      {/* Grid lines */}
                      <div className="absolute left-12 right-0 top-0 bottom-6 flex flex-col justify-between pointer-events-none">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <div key={i} className="border-t border-dashed border-[var(--border)]" />
                        ))}
                      </div>

                      {/* Bars */}
                      <div className="flex items-end justify-around h-36 gap-3 relative">
                        {data.efficiencyTrend.map((item) => (
                          <div
                            key={item.date}
                            className="flex-1 flex flex-col items-center"
                          >
                            {/* Value label */}
                            <span className="text-xs font-semibold text-[var(--foreground)] mb-1">
                              {item.efficiency.toFixed(1)}%
                            </span>
                            {/* Bar */}
                            <div
                              className="w-full max-w-12 bg-gradient-to-t from-[var(--primary)] to-[var(--primary-light)] rounded-t transition-all duration-500 min-h-[4px]"
                              style={{
                                height: `${Math.max((item.efficiency / 100) * 100, 5)}%`,
                              }}
                            />
                          </div>
                        ))}
                      </div>

                      {/* X-axis labels */}
                      <div className="flex justify-around mt-2">
                        {data.efficiencyTrend.map((item) => (
                          <span key={item.date} className="text-xs text-[var(--muted-foreground)] flex-1 text-center">
                            {item.date.replace("Week ", "W")}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-4 pt-4 mt-2 border-t border-[var(--border)]">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-[var(--success)]">
                        {Math.max(...data.efficiencyTrend.map((e) => e.efficiency)).toFixed(1)}%
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Peak Efficiency
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-[var(--primary)]">
                        {(
                          data.efficiencyTrend.reduce((sum, e) => sum + e.efficiency, 0) /
                          data.efficiencyTrend.length
                        ).toFixed(1)}%
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Average
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-40 text-[var(--muted-foreground)]">
                  <TrendingUp className="h-12 w-12 mb-2 opacity-30" />
                  <p>No efficiency data available</p>
                  <p className="text-xs mt-1">Create production records to see trends</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top Clients */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-[var(--primary)]" />
              Top Clients
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.topClients.length > 0 ? (
                data.topClients.map((client, index) => (
                  <div
                    key={client.name}
                    className="p-3 rounded-lg bg-[var(--muted)] hover:bg-[var(--accent)] transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-[var(--primary)] text-white text-xs flex items-center justify-center font-bold">
                            {index + 1}
                          </span>
                          <p className="font-medium">{client.name}</p>
                        </div>
                        <p className="text-sm text-[var(--muted-foreground)] mt-1 ml-8">
                          {client.orders} orders
                        </p>
                      </div>
                      <p className="font-bold text-[var(--primary)]">
                        {formatWeight(client.dispatched)}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-[var(--muted-foreground)]">
                  No client data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Key Metrics Summary */}
      <Card className="bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white">
        <CardContent className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center">
              <p className="text-white/70 text-sm">Scrap Rate</p>
              <p className="text-3xl font-bold mt-1">
                {data.summary.totalProduction > 0
                  ? ((data.summary.totalScrap / (data.summary.totalProduction * 500)) * 100).toFixed(1)
                  : 0}%
              </p>
              <div className="flex items-center justify-center gap-1 mt-1">
                <TrendingDown className="h-4 w-4" />
                <span className="text-sm">vs last period</span>
              </div>
            </div>
            <div className="text-center">
              <p className="text-white/70 text-sm">Yield Rate</p>
              <p className="text-3xl font-bold mt-1">
                {data.summary.avgEfficiency}%
              </p>
              <div className="flex items-center justify-center gap-1 mt-1">
                <TrendingUp className="h-4 w-4" />
                <span className="text-sm">avg efficiency</span>
              </div>
            </div>
            <div className="text-center">
              <p className="text-white/70 text-sm">Total Purchases</p>
              <p className="text-3xl font-bold mt-1">
                {formatWeight(data.summary.totalPurchases)}
              </p>
              <p className="text-sm text-white/70 mt-1">This period</p>
            </div>
            <div className="text-center">
              <p className="text-white/70 text-sm">Cost per Part</p>
              <p className="text-3xl font-bold mt-1">
                {data.summary.totalProduction > 0
                  ? formatCurrency(data.summary.purchaseValue / data.summary.totalProduction)
                  : formatCurrency(0)}
              </p>
              <p className="text-sm text-white/70 mt-1">Avg. material cost</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
