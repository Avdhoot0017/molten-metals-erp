"use client";

import * as React from "react";
import {
  Package,
  Recycle,
  Plus,
  Minus,
  History,
  Download,
  Filter,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { formatWeight, formatDateTime } from "@/lib/utils";
import {
  ALLOY_GRADES,
  ALL_MATERIAL_TYPES,
  MATERIAL_FORMS,
  gradeSpec,
  isScrapType,
  materialLabel,
  materialType,
  parseMaterialType,
} from "@/lib/ingot";
import { parseWeightInput, weightForExport, WEIGHT_UNIT } from "@/lib/units";
import { MaterialTypeSelect } from "@/components/inventory/material-type-select";
import { Pagination, type PaginationMeta } from "@/components/ui/pagination";
import {
  exportToExcel,
  fetchAllPages,
  timestampedFilename,
  sheet,
} from "@/lib/export-excel";
import type { AluminumType } from "@/types";

interface InventoryData {
  id: string;
  type: AluminumType;
  quantity: number;
  lastUpdated: string;
}

interface InventoryLog {
  id: string;
  type: AluminumType;
  action: string;
  quantity: number;
  previousQty: number;
  newQty: number;
  reference?: string;
  referenceId?: string;
  notes?: string;
  createdAt: string;
  user?: { name: string };
}

interface InventoryItem {
  type: AluminumType;
  label: string;
  quantity: number;
  color: string;
  bgColor: string;
}

/**
 * Colour follows the alloy grade, not the form: on a page listing twelve stock
 * lines, what an operator scans for is "where is my LM9", and the label
 * already says whether it is ingot or which scrap stream.
 */
function typeMeta(type: AluminumType): {
  label: string;
  color: string;
  bgColor: string;
} {
  const { grade } = parseMaterialType(type);
  const palette: Record<string, { color: string; bgColor: string }> = {
    LM6: { color: "text-[var(--primary)]", bgColor: "bg-[var(--accent)]" },
    LM9: { color: "text-emerald-600", bgColor: "bg-emerald-100" },
    LM25: { color: "text-violet-600", bgColor: "bg-violet-100" },
  };
  return {
    label: materialLabel(type),
    ...(palette[grade] ?? palette.LM6),
  };
}

export default function InventoryPage() {
  const [inventory, setInventory] = React.useState<InventoryItem[]>([]);
  const [logs, setLogs] = React.useState<InventoryLog[]>([]);
  const [logPage, setLogPage] = React.useState(1);
  const [logPageSize, setLogPageSize] = React.useState(10);
  const [logPagination, setLogPagination] = React.useState<PaginationMeta | null>(null);
  const [isExporting, setIsExporting] = React.useState(false);
  const [isPageLoading, setIsPageLoading] = React.useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isRemoveModalOpen, setIsRemoveModalOpen] = React.useState(false);
  const [selectedType, setSelectedType] = React.useState<AluminumType>("INGOT_LM6");
  const [quantity, setQuantity] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async () => {
    try {
      // Cache-busting timestamp avoids stale data; the log table is paged
      const params = new URLSearchParams({
        t: String(Date.now()),
        page: String(logPage),
        pageSize: String(logPageSize),
      });
      const response = await fetch(`/api/inventory?${params.toString()}`);
      const result = await response.json();

      if (result.success) {
        // Transform inventory data for display
        const inventoryItems: InventoryItem[] = ALL_MATERIAL_TYPES.map((type) => {
          const item = result.data.inventory.find((inv: InventoryData) => inv.type === type);
          const config = typeMeta(type);
          return {
            type,
            label: config.label,
            quantity: item?.quantity || 0,
            color: config.color,
            bgColor: config.bgColor,
          };
        });

        setInventory(inventoryItems);
        setLogs(result.data.logs || []);
        setLogPagination(result.pagination ?? null);
        setError(null);
      } else {
        setError(result.error || "Failed to fetch inventory data");
      }
    } catch (err) {
      console.error("Error fetching inventory:", err);
      setError("Failed to fetch inventory data");
    } finally {
      setIsPageLoading(false);
    }
  }, [logPage, logPageSize]);

  React.useEffect(() => {
    void (async () => {
      await fetchData();
    })();
  }, [fetchData]);

  const totalAluminum = inventory.reduce((sum, item) => sum + item.quantity, 0);

  // All recyclable scrap, and the split that makes it up
  const scrapBreakdown = inventory
    .filter((item) => isScrapType(item.type))
    .map((item) => ({
      ...item,
      // Bars share the grade's colour so the scrap split reads as one alloy
      barClass: gradeSpec(parseMaterialType(item.type).grade).dotClass,
    }));
  const totalScrap = scrapBreakdown.reduce((sum, item) => sum + item.quantity, 0);

  /**
   * Stock grouped by alloy, each grade holding its four forms in a fixed order.
   *
   * Twelve cards in one flat grid is a wall of numbers. Grade is what an
   * operator is actually looking for - "where is my LM9" - so the grades are
   * the sections and the forms line up in the same order inside each, which
   * makes the columns comparable straight down the page.
   */
  const byGrade = ALLOY_GRADES.map((grade) => {
    const items = MATERIAL_FORMS.map((form) => {
      const type = materialType(form.form, grade.grade);
      const item = inventory.find((i) => i.type === type);
      return {
        type,
        form,
        quantity: item?.quantity ?? 0,
      };
    });
    const total = items.reduce((sum, i) => sum + i.quantity, 0);
    return {
      ...grade,
      items,
      total,
      ingot: items.find((i) => i.form.form === "INGOT")?.quantity ?? 0,
      scrap: items
        .filter((i) => i.form.isScrap)
        .reduce((sum, i) => sum + i.quantity, 0),
    };
  });

  const handleExport = async () => {
    setIsExporting(true);
    try {
      // Stock levels come from state; the activity log is paged, so pull it all
      const allLogs = await fetchAllPages<InventoryLog>(
        "/api/inventory",
        {},
        { select: (data) => (data as { logs?: InventoryLog[] })?.logs ?? [] }
      );

      await exportToExcel(timestampedFilename("inventory"), [
        sheet<InventoryItem>({
          name: "Stock Levels",
          rows: inventory,
          columns: [
            { header: "Material Type", value: (i) => i.label, width: 26 },
            { header: "Quantity (kg)", value: (i) => weightForExport(i.quantity), width: 16 },
            {
              header: "Share of Total (%)",
              value: (i) =>
                totalAluminum > 0
                  ? Number(((i.quantity / totalAluminum) * 100).toFixed(2))
                  : 0,
              width: 18,
            },
          ],
        }),
        sheet<InventoryLog>({
          name: "Activity Log",
          rows: allLogs,
          columns: [
            {
              header: "Date",
              value: (l) => formatDateTime(new Date(l.createdAt)),
              width: 20,
            },
            { header: "Material Type", value: (l) => materialLabel(l.type), width: 22 },
            { header: "Action", value: (l) => l.action, width: 12 },
            { header: "Quantity (kg)", value: (l) => weightForExport(l.quantity), width: 15 },
            { header: "Previous (kg)", value: (l) => weightForExport(l.previousQty), width: 15 },
            { header: "New (kg)", value: (l) => weightForExport(l.newQty), width: 15 },
            { header: "Reference", value: (l) => l.reference ?? "", width: 18 },
            { header: "Recorded By", value: (l) => l.user?.name ?? "", width: 18 },
            { header: "Notes", value: (l) => l.notes ?? "", width: 34 },
          ],
        }),
      ]);
    } catch (err) {
      console.error("Export failed:", err);
      setError("Failed to export inventory");
    } finally {
      setIsExporting(false);
    }
  };

  const handleAddStock = async () => {
    if (!quantity || parseFloat(quantity) <= 0) {
      setError("Please enter a valid quantity");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: selectedType,
          action: "ADD",
          quantity: parseWeightInput(quantity),
          notes: notes || undefined,
        }),
      });

      const result = await response.json();

      if (result.success) {
        await fetchData();
        setIsAddModalOpen(false);
        resetForm();
      } else {
        setError(result.error || "Failed to add stock");
      }
    } catch (err) {
      console.error("Error adding stock:", err);
      setError("Failed to add stock");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveStock = async () => {
    if (!quantity || parseFloat(quantity) <= 0) {
      setError("Please enter a valid quantity");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: selectedType,
          action: "REMOVE",
          quantity: parseWeightInput(quantity),
          notes: notes || undefined,
        }),
      });

      const result = await response.json();

      if (result.success) {
        await fetchData();
        setIsRemoveModalOpen(false);
        resetForm();
      } else {
        setError(result.error || "Failed to remove stock");
      }
    } catch (err) {
      console.error("Error removing stock:", err);
      setError("Failed to remove stock");
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setSelectedType("INGOT_LM6");
    setQuantity("");
    setNotes("");
    setError(null);
  };

  if (isPageLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Inventory Management
          </h1>
          <p className="text-[var(--muted-foreground)]">
            Manage aluminum stock levels and track inventory changes
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            isLoading={isExporting}
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button variant="secondary" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Total Inventory Card */}
      <Card className="bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-sm">Total Aluminum Inventory</p>
              <p className="text-4xl font-bold mt-1">
                {formatWeight(totalAluminum)}
              </p>
              <p className="text-white/70 text-sm mt-2">
                Across all material types
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="bg-white text-[var(--primary)] hover:bg-white/90"
                onClick={() => setIsAddModalOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Stock
              </Button>
              <Button
                variant="outline"
                className="border-white text-white hover:bg-white/20"
                onClick={() => setIsRemoveModalOpen(true)}
              >
                <Minus className="h-4 w-4 mr-2" />
                Use Stock
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stock by alloy. One section per grade, the four forms in the same
          order inside each, so the columns line up down the page. */}
      <div className="space-y-5">
        {byGrade.map((grade) => (
          <div key={grade.grade}>
            {/* Section header: which alloy, and what it holds in total */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className={`h-3 w-3 rounded-full ${grade.dotClass}`} />
                <h3 className="text-base font-semibold text-[var(--foreground)]">
                  {grade.grade}
                </h3>
                <span className="text-sm text-[var(--muted-foreground)]">
                  {grade.description}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="font-semibold text-[var(--foreground)]">
                  {formatWeight(grade.total)}
                </span>
                <Badge variant="outline" className="text-xs">
                  {totalAluminum > 0
                    ? ((grade.total / totalAluminum) * 100).toFixed(1)
                    : 0}
                  % of all metal
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {grade.items.map((item) => {
                const Icon = item.form.isScrap ? Recycle : Package;
                // Share within the grade, not of everything - inside an LM9
                // section, LM9's own split is the useful comparison
                const share =
                  grade.total > 0 ? (item.quantity / grade.total) * 100 : 0;
                const empty = item.quantity === 0;

                return (
                  <Card
                    key={item.type}
                    className={`transition-shadow hover:shadow-md ${
                      empty ? "opacity-60" : ""
                    }`}
                  >
                    <CardContent className="flex h-full flex-col p-5">
                      <div className="flex items-start justify-between">
                        <div
                          className={`rounded-lg p-2.5 ${
                            item.form.isScrap
                              ? "bg-[var(--muted)]"
                              : gradeSpec(grade.grade).iconClass
                          }`}
                        >
                          <Icon
                            className={`h-5 w-5 ${
                              item.form.isScrap
                                ? "text-[var(--muted-foreground)]"
                                : "text-[var(--primary)]"
                            }`}
                          />
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {share.toFixed(1)}%
                        </Badge>
                      </div>

                      {/* Grade is in the section header, so only the form is
                          named here */}
                      <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                        {item.form.label}
                      </p>
                      <p className="mt-0.5 text-xl font-bold">
                        {formatWeight(item.quantity)}
                      </p>

                      <div className="mt-auto pt-4">
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
                          <div
                            className={`h-full rounded-full ${grade.dotClass} transition-all duration-500`}
                            style={{ width: `${share}%` }}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Total Scrap with its segment breakdown */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-100 p-3">
                <Recycle className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">Total Scrap</p>
                <p className="mt-1 text-2xl font-bold">{formatWeight(totalScrap)}</p>
              </div>
            </div>
            <Badge variant="outline" className="text-xs">
              {totalAluminum > 0
                ? ((totalScrap / totalAluminum) * 100).toFixed(1)
                : 0}
              % of total aluminium
            </Badge>
          </div>

          {/* Stacked segments - each scrap type's share of total scrap */}
          <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-[var(--muted)]">
            {scrapBreakdown.map((item) => (
              <div
                key={item.type}
                className={`${item.barClass} transition-all duration-500`}
                style={{
                  width:
                    totalScrap > 0 ? `${(item.quantity / totalScrap) * 100}%` : "0%",
                }}
                title={`${item.label}: ${formatWeight(item.quantity)}`}
              />
            ))}
          </div>

          {/* Legend, grouped the same way as the cards above: one column per
              alloy, the three scrap streams listed inside it */}
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {byGrade.map((grade) => (
              <div
                key={grade.grade}
                className="rounded-lg border border-[var(--border)] p-3"
              >
                <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
                  <span className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${grade.dotClass}`} />
                    <span className="text-sm font-medium">{grade.grade}</span>
                  </span>
                  <span className="text-sm font-semibold">
                    {formatWeight(grade.scrap)}
                  </span>
                </div>
                <div className="mt-2 space-y-1.5">
                  {grade.items
                    .filter((item) => item.form.isScrap)
                    .map((item) => (
                      <div
                        key={item.type}
                        className="flex items-baseline justify-between gap-2 text-sm"
                      >
                        <span className="text-[var(--muted-foreground)]">
                          {item.form.label}
                        </span>
                        <span
                          className={
                            item.quantity > 0
                              ? "font-medium"
                              : "text-[var(--muted-foreground)]"
                          }
                        >
                          {formatWeight(item.quantity)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-[var(--primary)]" />
            Recent Inventory Activity
          </CardTitle>
          <Button variant="ghost" size="sm">
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-center py-8 text-[var(--muted-foreground)]">
              No inventory activity yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Date & Time
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Type
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Action
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Quantity
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Previous → New
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Notes
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      User
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-[var(--border)] hover:bg-[var(--muted)]"
                    >
                      <td className="py-3 px-4 text-sm">
                        {formatDateTime(new Date(log.createdAt))}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="secondary">
                          {materialLabel(log.type)}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={log.action === "ADD" ? "success" : "error"}
                        >
                          {log.action}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 font-medium">
                        {log.quantity >= 0 ? "+" : ""}
                        {formatWeight(Math.abs(log.quantity))}
                      </td>
                      <td className="py-3 px-4 text-sm text-[var(--muted-foreground)]">
                        {formatWeight(log.previousQty)} → {formatWeight(log.newQty)}
                      </td>
                      <td className="py-3 px-4 text-sm">{log.notes || "-"}</td>
                      <td className="py-3 px-4 text-sm">{log.user?.name || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {logPagination && (
            <Pagination
              className="mt-4"
              meta={logPagination}
              onPageChange={setLogPage}
              onPageSizeChange={(size) => {
                setLogPageSize(size);
                setLogPage(1);
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Add Stock Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          resetForm();
        }}
        title="Add Stock"
        description="Add aluminum stock to inventory"
      >
        <div className="space-y-4 pb-2">
          {error && (
            <div className="p-3 rounded-lg bg-red-100 text-red-700 text-sm">
              {error}
            </div>
          )}
          <MaterialTypeSelect
            value={selectedType}
            onChange={setSelectedType}
          />
          <div>
            <Input
              label={`Quantity (in ${WEIGHT_UNIT})`}
              type="number"
              placeholder="e.g., 5000"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-12"
            />
          </div>
          <Textarea
            label="Notes (Optional)"
            placeholder="Add any notes about this transaction..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[80px]"
          />
        </div>
        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => {
              setIsAddModalOpen(false);
              resetForm();
            }}
          >
            Cancel
          </Button>
          <Button className="h-12" onClick={handleAddStock} isLoading={isLoading}>
            <Plus className="h-4 w-4 mr-2" />
            Add Stock
          </Button>
        </ModalFooter>
      </Modal>

      {/* Remove Stock Modal */}
      <Modal
        isOpen={isRemoveModalOpen}
        onClose={() => {
          setIsRemoveModalOpen(false);
          resetForm();
        }}
        title="Use Stock"
        description="Remove aluminum from inventory"
      >
        <div className="space-y-4 pb-2">
          {error && (
            <div className="p-3 rounded-lg bg-red-100 text-red-700 text-sm">
              {error}
            </div>
          )}
          <MaterialTypeSelect
            value={selectedType}
            onChange={setSelectedType}
          />
          <div>
            <Input
              label={`Quantity (in ${WEIGHT_UNIT})`}
              type="number"
              placeholder="e.g., 5000"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-12"
            />
          </div>
          <Textarea
            label="Notes (Optional)"
            placeholder="Add any notes about this usage..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[80px]"
          />
        </div>
        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => {
              setIsRemoveModalOpen(false);
              resetForm();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="h-12"
            onClick={handleRemoveStock}
            isLoading={isLoading}
          >
            <Minus className="h-4 w-4 mr-2" />
            Use Stock
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
