"use client";

import * as React from "react";
import {
  ShoppingCart,
  Plus,
  Search,
  Download,
  Eye,
  Truck,
  CheckCircle,
  Clock,
  XCircle,
  Package,
  Loader2,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stat-card";
import { formatWeight, formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { downloadPurchaseOrderPdf } from "@/lib/po-pdf";
import { parseWeightInput, weightForExport, WEIGHT_UNIT } from "@/lib/units";
import { INGOT_GRADES, gradeName } from "@/lib/ingot";
import type { AluminumType } from "@/types";
import {
  exportToExcel,
  fetchAllPages,
  timestampedFilename,
  sheet,
} from "@/lib/export-excel";
import type { POStatus } from "@/types";

interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplier: {
    name: string;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    gstNumber?: string | null;
  };
  user?: { name: string };
  createdAt: string;
  expectedDate: string | null;
  deliveredDate: string | null;
  quantity: number;
  ingotType: AluminumType;
  pricePerKg: number;
  totalAmount: number;
  status: POStatus;
  notes?: string;
}

const statusConfig: Record<POStatus, { label: string; variant: "default" | "success" | "warning" | "error" | "info"; icon: React.ElementType }> = {
  PENDING: { label: "Pending", variant: "warning", icon: Clock },
  CONFIRMED: { label: "Confirmed", variant: "info", icon: CheckCircle },
  IN_TRANSIT: { label: "In Transit", variant: "info", icon: Truck },
  DELIVERED: { label: "Delivered", variant: "success", icon: Package },
  CANCELLED: { label: "Cancelled", variant: "error", icon: XCircle },
};

export default function PurchaseOrdersPage() {
  const [purchaseOrders, setPurchaseOrders] = React.useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [isPageLoading, setIsPageLoading] = React.useState(true);
  const [isNewPOModalOpen, setIsNewPOModalOpen] = React.useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = React.useState(false);
  const [isUpdateStatusModalOpen, setIsUpdateStatusModalOpen] = React.useState(false);
  const [selectedPO, setSelectedPO] = React.useState<PurchaseOrder | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("ALL");
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Set after a successful create so the user can download the PO PDF straight away
  const [createdPO, setCreatedPO] = React.useState<PurchaseOrder | null>(null);
  const [isExporting, setIsExporting] = React.useState(false);

  // Form state
  const [formData, setFormData] = React.useState({
    supplierId: "",
    ingotType: "INGOT_LM6" as AluminumType,
    quantity: "",
    pricePerKg: "",
    expectedDate: "",
    notes: "",
  });

  const [newStatus, setNewStatus] = React.useState<POStatus>("PENDING");

  const fetchData = React.useCallback(async () => {
    try {
      const [ordersRes, suppliersRes] = await Promise.all([
        fetch("/api/purchase-orders"),
        fetch("/api/suppliers"),
      ]);

      const ordersData = await ordersRes.json();
      const suppliersData = await suppliersRes.json();

      if (ordersData.success) {
        setPurchaseOrders(ordersData.data || []);
      }

      if (suppliersData.success) {
        setSuppliers(suppliersData.data || []);
      }
    } catch (err) {
      console.error("Error fetching data:", err);
      setError("Failed to fetch data");
    } finally {
      setIsPageLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredOrders = purchaseOrders.filter((po) => {
    const matchesSearch =
      po.poNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      po.supplier.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "ALL" || po.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: purchaseOrders.length,
    pending: purchaseOrders.filter((p) => p.status === "PENDING").length,
    inTransit: purchaseOrders.filter((p) => p.status === "IN_TRANSIT").length,
    delivered: purchaseOrders.filter((p) => p.status === "DELIVERED").length,
    totalValue: purchaseOrders.reduce((sum, p) => sum + p.totalAmount, 0),
  };

  const supplierOptions = suppliers.map((s) => ({
    value: s.id,
    label: s.name,
  }));

  const resetForm = () => {
    setFormData({
      supplierId: "",
      ingotType: "INGOT_LM6" as AluminumType,
      quantity: "",
      pricePerKg: "",
      expectedDate: "",
      notes: "",
    });
    setError(null);
    setCreatedPO(null);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const orders = await fetchAllPages<PurchaseOrder>("/api/purchase-orders");
      await exportToExcel(timestampedFilename("purchase-orders"), [
        sheet<PurchaseOrder>({
          name: "Purchase Orders",
          rows: orders,
          columns: [
            { header: "PO Number", value: (o) => o.poNumber, width: 20 },
            { header: "Supplier", value: (o) => o.supplier.name, width: 28 },
            { header: "Contact", value: (o) => o.supplier.contactPerson ?? "", width: 20 },
            { header: "GSTIN", value: (o) => o.supplier.gstNumber ?? "", width: 20 },
            {
              header: "Order Date",
              value: (o) => formatDate(new Date(o.createdAt)),
              width: 14,
            },
            {
              header: "Expected Date",
              value: (o) => (o.expectedDate ? formatDate(new Date(o.expectedDate)) : ""),
              width: 15,
            },
            {
              header: "Delivered Date",
              value: (o) => (o.deliveredDate ? formatDate(new Date(o.deliveredDate)) : ""),
              width: 15,
            },
            { header: "Grade", value: (o) => gradeName(o.ingotType) ?? "", width: 10 },
            { header: "Quantity (kg)", value: (o) => weightForExport(o.quantity), width: 15 },
            { header: "Price per KG", value: (o) => o.pricePerKg, width: 14 },
            { header: "Total Amount", value: (o) => o.totalAmount, width: 15 },
            { header: "Status", value: (o) => statusConfig[o.status].label },
            { header: "Created By", value: (o) => o.user?.name ?? "", width: 18 },
            { header: "Notes", value: (o) => o.notes ?? "", width: 30 },
          ],
        }),
      ]);
    } catch (err) {
      console.error("Export failed:", err);
      setError("Failed to export purchase orders");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadPdf = async (po: PurchaseOrder) => {
    await downloadPurchaseOrderPdf({
      poNumber: po.poNumber,
      status: po.status,
      createdAt: po.createdAt,
      expectedDate: po.expectedDate,
      deliveredDate: po.deliveredDate,
      quantity: po.quantity,
      pricePerKg: po.pricePerKg,
      totalAmount: po.totalAmount,
      notes: po.notes,
      supplier: po.supplier,
      user: po.user,
    });
  };

  const handleCreatePO = async () => {
    if (!formData.supplierId || !formData.quantity || !formData.pricePerKg) {
      setError("Supplier, quantity, and price are required");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: formData.supplierId,
          ingotType: formData.ingotType,
          quantity: parseWeightInput(formData.quantity),
          pricePerKg: parseFloat(formData.pricePerKg),
          expectedDate: formData.expectedDate || undefined,
          notes: formData.notes || undefined,
        }),
      });

      const result = await response.json();

      if (result.success) {
        await fetchData();
        // Keep the modal open on a success screen offering the PDF download
        setCreatedPO(result.data as PurchaseOrder);
      } else {
        setError(result.error || "Failed to create purchase order");
      }
    } catch (err) {
      console.error("Error creating purchase order:", err);
      setError("Failed to create purchase order");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!selectedPO) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/purchase-orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedPO.id,
          status: newStatus,
          deliveredDate: newStatus === "DELIVERED" ? new Date().toISOString() : undefined,
        }),
      });

      const result = await response.json();

      if (result.success) {
        await fetchData();
        setIsUpdateStatusModalOpen(false);
        setSelectedPO(null);
      } else {
        setError(result.error || "Failed to update status");
      }
    } catch (err) {
      console.error("Error updating status:", err);
      setError("Failed to update status");
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate total amount
  const calculatedTotal = React.useMemo(() => {
    const kg = parseFloat(formData.quantity) || 0;
    const price = parseFloat(formData.pricePerKg) || 0;
    // The field is typed in kg and the rate is quoted per kg, so this is direct
    return kg * price;
  }, [formData.quantity, formData.pricePerKg]);

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
            Purchase Orders
          </h1>
          <p className="text-[var(--muted-foreground)]">
            Manage ingot purchase orders from suppliers
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
          <Button onClick={() => setIsNewPOModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Purchase Order
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          title="Total Orders"
          value={stats.total}
          icon={ShoppingCart}
        />
        <StatCard
          title="Pending"
          value={stats.pending}
          icon={Clock}
          iconClassName="bg-amber-100"
        />
        <StatCard
          title="In Transit"
          value={stats.inTransit}
          icon={Truck}
          iconClassName="bg-blue-100"
        />
        <StatCard
          title="Delivered"
          value={stats.delivered}
          icon={CheckCircle}
          iconClassName="bg-green-100"
        />
        <StatCard
          title="Total Value"
          value={formatCurrency(stats.totalValue)}
          icon={Package}
        />
      </div>

      {/* Search and Filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Search grows to fill the row */}
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Search by PO number or supplier..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Width sits on the wrapper - Select passes className to the inner
                control, whose parent is always w-full */}
            <div className="w-full sm:w-48 shrink-0">
              <Select
                options={[
                  { value: "ALL", label: "All Status" },
                  { value: "PENDING", label: "Pending" },
                  { value: "CONFIRMED", label: "Confirmed" },
                  { value: "IN_TRANSIT", label: "In Transit" },
                  { value: "DELIVERED", label: "Delivered" },
                  { value: "CANCELLED", label: "Cancelled" },
                ]}
                value={statusFilter}
                onChange={setStatusFilter}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Purchase Orders Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-[var(--primary)]" />
            Purchase Orders
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredOrders.length === 0 ? (
            <div className="text-center py-8 text-[var(--muted-foreground)]">
              No purchase orders found
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
                      Order Date
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Quantity
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Amount
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Expected Date
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Status
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((po) => {
                    const StatusIcon = statusConfig[po.status].icon;
                    return (
                      <tr
                        key={po.id}
                        className="border-b border-[var(--border)] hover:bg-[var(--muted)]"
                      >
                        <td className="py-3 px-4">
                          <span className="font-mono text-sm bg-[var(--muted)] px-2 py-1 rounded">
                            {po.poNumber}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-medium">
                          {po.supplier.name}
                        </td>
                        <td className="py-3 px-4 text-sm text-[var(--muted-foreground)]">
                          {formatDate(new Date(po.createdAt))}
                        </td>
                        <td className="py-3 px-4">
                          <span className="flex items-center gap-2">
                            {formatWeight(po.quantity)}
                            <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-xs font-medium">
                              {gradeName(po.ingotType) ?? "-"}
                            </span>
                          </span>
                        </td>
                        <td className="py-3 px-4 font-medium">
                          {formatCurrency(po.totalAmount)}
                        </td>
                        <td className="py-3 px-4 text-sm">
                          {po.expectedDate ? formatDate(new Date(po.expectedDate)) : "-"}
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant={statusConfig[po.status].variant}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {statusConfig[po.status].label}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedPO(po);
                                setIsViewModalOpen(true);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Download PDF"
                              onClick={() => void handleDownloadPdf(po)}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                            {po.status !== "DELIVERED" && po.status !== "CANCELLED" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedPO(po);
                                  setNewStatus(po.status);
                                  setIsUpdateStatusModalOpen(true);
                                }}
                              >
                                Update
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* New PO Modal */}
      <Modal
        isOpen={isNewPOModalOpen}
        onClose={() => {
          setIsNewPOModalOpen(false);
          resetForm();
        }}
        title={createdPO ? "Purchase Order Created" : "New Purchase Order"}
        description={
          createdPO
            ? "The order has been saved. Download the PDF to send it to your supplier."
            : "Create a new purchase order for ingot"
        }
        size="lg"
      >
        {createdPO ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-[var(--success-light)] border border-[var(--success)]">
              <CheckCircle className="h-6 w-6 text-green-700 shrink-0" />
              <div>
                <p className="font-semibold text-green-800">
                  {createdPO.poNumber} created successfully
                </p>
                <p className="text-sm text-green-700">
                  {createdPO.supplier.name} &middot;{" "}
                  {formatWeight(createdPO.quantity)} &middot;{" "}
                  {formatCurrency(createdPO.totalAmount)}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border border-[var(--border)]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--accent)]">
                  <FileText className="h-5 w-5 text-[var(--primary)]" />
                </div>
                <div>
                  <p className="font-medium">Purchase Order PDF</p>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {createdPO.poNumber}.pdf
                  </p>
                </div>
              </div>
              <Button onClick={() => void handleDownloadPdf(createdPO)}>
                <Download className="h-4 w-4 mr-2" />
                Download PDF
              </Button>
            </div>
          </div>
        ) : (
        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-100 text-red-700 text-sm">
              {error}
            </div>
          )}
          <Select
            label="Supplier"
            options={supplierOptions}
            value={formData.supplierId}
            onChange={(value) =>
              setFormData({ ...formData, supplierId: value })
            }
            placeholder="Select a supplier"
          />
          <Select
            label="Ingot Grade"
            options={INGOT_GRADES.map((g) => ({
              value: g.type,
              label: `${g.label} - ${g.description}`,
            }))}
            value={formData.ingotType}
            onChange={(value) =>
              setFormData({ ...formData, ingotType: value as AluminumType })
            }
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={`Quantity (${WEIGHT_UNIT})`}
              type="number"
              placeholder="Enter quantity in kg"
              value={formData.quantity}
              onChange={(e) =>
                setFormData({ ...formData, quantity: e.target.value })
              }
            />
            <Input
              label="Price per KG (₹)"
              type="number"
              placeholder="Enter price per kg"
              value={formData.pricePerKg}
              onChange={(e) =>
                setFormData({ ...formData, pricePerKg: e.target.value })
              }
            />
          </div>
          <Input
            label="Expected Delivery Date"
            type="date"
            value={formData.expectedDate}
            onChange={(e) =>
              setFormData({ ...formData, expectedDate: e.target.value })
            }
          />
          <Textarea
            label="Notes (Optional)"
            placeholder="Add any notes about this order..."
            value={formData.notes}
            onChange={(e) =>
              setFormData({ ...formData, notes: e.target.value })
            }
          />

          {/* Calculated Total */}
          <div className="p-4 rounded-lg bg-[var(--accent)] border border-[var(--primary)]/20">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--foreground)]">
                Estimated Total
              </span>
              <span className="text-xl font-bold text-[var(--primary)]">
                {formatCurrency(calculatedTotal)}
              </span>
            </div>
          </div>
        </div>
        )}

        <ModalFooter>
          {createdPO ? (
            <Button
              onClick={() => {
                setIsNewPOModalOpen(false);
                resetForm();
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setIsNewPOModalOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleCreatePO} isLoading={isLoading}>
                <Plus className="h-4 w-4 mr-2" />
                Create Order
              </Button>
            </>
          )}
        </ModalFooter>
      </Modal>

      {/* View PO Modal */}
      <Modal
        isOpen={isViewModalOpen}
        onClose={() => {
          setIsViewModalOpen(false);
          setSelectedPO(null);
        }}
        title="Purchase Order Details"
        size="lg"
      >
        {selectedPO && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--muted)]">
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">
                  PO Number
                </p>
                <p className="font-mono text-lg font-bold">
                  {selectedPO.poNumber}
                </p>
              </div>
              <Badge
                variant={statusConfig[selectedPO.status].variant}
                className="text-base px-4 py-2"
              >
                {statusConfig[selectedPO.status].label}
              </Badge>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border border-[var(--border)]">
                <p className="text-sm text-[var(--muted-foreground)]">
                  Supplier
                </p>
                <p className="font-medium">{selectedPO.supplier.name}</p>
              </div>
              <div className="p-4 rounded-lg border border-[var(--border)]">
                <p className="text-sm text-[var(--muted-foreground)]">
                  Order Date
                </p>
                <p className="font-medium">
                  {formatDateTime(new Date(selectedPO.createdAt))}
                </p>
              </div>
              <div className="p-4 rounded-lg border border-[var(--border)]">
                <p className="text-sm text-[var(--muted-foreground)]">
                  Quantity
                </p>
                <p className="font-medium">
                  {formatWeight(selectedPO.quantity)}
                  <span className="ml-2 rounded bg-[var(--muted)] px-1.5 py-0.5 text-xs font-medium">
                    {gradeName(selectedPO.ingotType) ?? "-"}
                  </span>
                </p>
              </div>
              <div className="p-4 rounded-lg border border-[var(--border)]">
                <p className="text-sm text-[var(--muted-foreground)]">
                  Price per KG
                </p>
                <p className="font-medium">
                  {formatCurrency(selectedPO.pricePerKg)}
                </p>
              </div>
              <div className="p-4 rounded-lg border border-[var(--border)]">
                <p className="text-sm text-[var(--muted-foreground)]">
                  Expected Delivery
                </p>
                <p className="font-medium">
                  {selectedPO.expectedDate
                    ? formatDate(new Date(selectedPO.expectedDate))
                    : "-"}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-[var(--accent)]">
                <p className="text-sm text-[var(--primary-dark)]">
                  Total Amount
                </p>
                <p className="text-xl font-bold text-[var(--primary)]">
                  {formatCurrency(selectedPO.totalAmount)}
                </p>
              </div>
            </div>

            {selectedPO.notes && (
              <div className="p-4 rounded-lg border border-[var(--border)]">
                <p className="text-sm text-[var(--muted-foreground)] mb-1">
                  Notes
                </p>
                <p className="text-[var(--foreground)]">{selectedPO.notes}</p>
              </div>
            )}

            {selectedPO.deliveredDate && (
              <div className="p-4 rounded-lg bg-[var(--success-light)] border border-[var(--success)]">
                <p className="text-sm text-green-700">
                  Delivered on {formatDateTime(new Date(selectedPO.deliveredDate))}
                </p>
              </div>
            )}
          </div>
        )}

        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setIsViewModalOpen(false);
              setSelectedPO(null);
            }}
          >
            Close
          </Button>
          {selectedPO && (
            <Button onClick={() => void handleDownloadPdf(selectedPO)}>
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          )}
        </ModalFooter>
      </Modal>

      {/* Update Status Modal */}
      <Modal
        isOpen={isUpdateStatusModalOpen}
        onClose={() => {
          setIsUpdateStatusModalOpen(false);
          setSelectedPO(null);
          setError(null);
        }}
        title="Update Order Status"
        size="sm"
      >
        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-100 text-red-700 text-sm">
              {error}
            </div>
          )}
          <p className="text-[var(--muted-foreground)]">
            Update the status for{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {selectedPO?.poNumber}
            </span>
          </p>
          <Select
            label="New Status"
            options={[
              { value: "PENDING", label: "Pending" },
              { value: "CONFIRMED", label: "Confirmed" },
              { value: "IN_TRANSIT", label: "In Transit" },
              { value: "DELIVERED", label: "Delivered" },
              { value: "CANCELLED", label: "Cancelled" },
            ]}
            value={newStatus}
            onChange={(value) => setNewStatus(value as POStatus)}
          />
          {newStatus === "DELIVERED" && (
            <div className="p-4 rounded-lg bg-[var(--info-light)] border border-[var(--info)]/20">
              <p className="text-sm text-[var(--info)]">
                Marking as delivered will automatically add{" "}
                {formatWeight(selectedPO?.quantity || 0)} to your{" "}
                {selectedPO ? gradeName(selectedPO.ingotType) ?? "Ingot" : "Ingot"}{" "}
                ingot stock.
              </p>
            </div>
          )}
        </div>

        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setIsUpdateStatusModalOpen(false);
              setSelectedPO(null);
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleUpdateStatus} isLoading={isLoading}>
            Update Status
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
