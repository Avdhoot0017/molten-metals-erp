"use client";

import * as React from "react";
import Link from "next/link";
import {
  Receipt,
  Plus,
  Search,
  Edit,
  Trash2,
  RefreshCw,
  Eye,
  Building2,
  IndianRupee,
  Package,
  FileText,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSpinner } from "@/components/ui/loading";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { lineAmounts, orderTotals, rupeesInWords } from "@/lib/customer-orders";
import { canWrite } from "@/lib/permissions";
import type { UserRole } from "@/types";

/**
 * Purchase orders received FROM customers - what they have ordered from us.
 *
 * The Purchase Orders page is the other direction: us buying ingot from a
 * supplier. Nothing here moves stock or pieces; an order is a record of what
 * has been promised, entered from the sheet of paper the customer sent.
 */

type OrderStatus = "OPEN" | "PARTIAL" | "COMPLETED" | "CANCELLED";

const STATUS_LABELS: Record<OrderStatus, string> = {
  OPEN: "Open",
  PARTIAL: "Part supplied",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STATUS_VARIANTS: Record<OrderStatus, "warning" | "info" | "success" | "secondary"> = {
  OPEN: "warning",
  PARTIAL: "info",
  COMPLETED: "success",
  CANCELLED: "secondary",
};

interface CustomerRef {
  id: string;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  gstNumber?: string | null;
  stateCode?: string | null;
}

interface PartRef {
  id: string;
  partCode: string;
  name: string;
}

interface OrderItem {
  id: string;
  sequence: number;
  partId: string | null;
  part?: PartRef | null;
  itemCode: string;
  description: string | null;
  hsnCode: string | null;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  scheduleDate: string | null;
  scheduleQty: number | null;
}

interface CustomerOrder {
  id: string;
  poNumber: string;
  companyId: string;
  company: CustomerRef;
  poDate: string;
  referenceNo: string | null;
  referenceDate: string | null;
  deliveryAddress: string | null;
  transporterName: string | null;
  transport: string | null;
  paymentTerms: string | null;
  status: OrderStatus;
  subTotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  grandTotal: number;
  specialInstructions: string | null;
  notes: string | null;
  items: OrderItem[];
  user?: { name: string } | null;
  createdAt: string;
}

/** One line as the form holds it - every figure a string, as typed. */
interface DraftLine {
  /** Stable across re-orders and deletes, so React keeps the right inputs. */
  key: string;
  partId: string;
  itemCode: string;
  description: string;
  hsnCode: string;
  quantity: string;
  unit: string;
  rate: string;
  cgstRate: string;
  sgstRate: string;
  igstRate: string;
  scheduleDate: string;
  scheduleQty: string;
}

let lineCounter = 0;
function newLine(defaults?: Partial<DraftLine>): DraftLine {
  lineCounter += 1;
  return {
    key: `line-${lineCounter}`,
    partId: "",
    itemCode: "",
    description: "",
    hsnCode: "",
    quantity: "",
    unit: "NOS",
    rate: "",
    cgstRate: "9",
    sgstRate: "9",
    igstRate: "0",
    scheduleDate: "",
    scheduleQty: "",
    ...defaults,
  };
}

/** A date from the API, as a value a date input will accept. */
function dateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function num(value: string): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function CustomerOrdersPage() {
  const [orders, setOrders] = React.useState<CustomerOrder[]>([]);
  const [customers, setCustomers] = React.useState<CustomerRef[]>([]);
  const [parts, setParts] = React.useState<PartRef[]>([]);
  const [isPageLoading, setIsPageLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterCustomer, setFilterCustomer] = React.useState("");
  const [filterStatus, setFilterStatus] = React.useState("");

  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [viewing, setViewing] = React.useState<CustomerOrder | null>(null);
  const [deleting, setDeleting] = React.useState<CustomerOrder | null>(null);

  const [role, setRole] = React.useState<UserRole | null>(null);
  const canManage = role ? canWrite({ role }, "customerOrders") : false;

  /* The order being written up. Header fields and the lines beneath them. */
  const [header, setHeader] = React.useState({
    companyId: "",
    poNumber: "",
    poDate: todayInput(),
    referenceNo: "",
    referenceDate: "",
    paymentTerms: "",
    /*
     * No longer keyed in - the transporter box was dropped from the form.
     * It stays in this state so editing an older order carries its saved
     * value through instead of blanking the column.
     */
    transporterName: "",
    transport: "",
    deliveryAddress: "",
    specialInstructions: "",
    notes: "",
    status: "OPEN" as OrderStatus,
  });
  const [lines, setLines] = React.useState<DraftLine[]>([newLine()]);
  /*
   * Which tax applies. Within the state it is split CGST/SGST, outside it is
   * one IGST line - never both, and getting it wrong is the commonest
   * mistake when an order is keyed in, so it is one choice at the top rather
   * than three rate boxes per line to remember.
   */
  const [taxMode, setTaxMode] = React.useState<"CGST_SGST" | "IGST">("CGST_SGST");
  const [taxRate, setTaxRate] = React.useState("18");

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        if (data.success) setRole(data.user.role);
      } catch {
        // A failed read leaves the page read-only
      }
    })();
  }, []);

  const fetchAll = React.useCallback(async () => {
    setIsPageLoading(true);
    try {
      const [orderRes, customerRes, partRes] = await Promise.all([
        fetch("/api/customer-orders"),
        fetch("/api/companies"),
        // Unpaginated (no ?page), so the whole catalogue comes back for
        // the per-line part picker
        fetch("/api/parts"),
      ]);

      const orderData = await orderRes.json();
      if (orderData.success) setOrders(orderData.data);

      const customerData = await customerRes.json();
      if (customerData.success) setCustomers(customerData.data);

      if (partRes.ok) {
        const partData = await partRes.json();
        if (partData.success) setParts(partData.data ?? []);
      }
    } catch (err) {
      console.error("Error loading customer orders:", err);
    } finally {
      setIsPageLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /* Arriving from a customer's row on the Customers page pre-filters here. */
  React.useEffect(() => {
    const customerId = new URLSearchParams(window.location.search).get("customer");
    if (customerId) setFilterCustomer(customerId);
  }, []);

  const resetForm = () => {
    setHeader({
      companyId: "",
      poNumber: "",
      poDate: todayInput(),
      referenceNo: "",
      referenceDate: "",
      paymentTerms: "",
      transporterName: "",
      transport: "",
      deliveryAddress: "",
      specialInstructions: "",
      notes: "",
      status: "OPEN",
    });
    setTaxMode("CGST_SGST");
    setTaxRate("18");
    setLines([newLine()]);
    setEditingId(null);
    setError("");
  };

  const openCreate = () => {
    resetForm();
    setHeader((h) => ({ ...h, companyId: filterCustomer || "" }));
    setIsFormOpen(true);
  };

  const openEdit = (order: CustomerOrder) => {
    const usesIgst = order.items.some((item) => item.igstRate > 0);
    setEditingId(order.id);
    setHeader({
      companyId: order.companyId,
      poNumber: order.poNumber,
      poDate: dateInputValue(order.poDate),
      referenceNo: order.referenceNo ?? "",
      referenceDate: dateInputValue(order.referenceDate),
      paymentTerms: order.paymentTerms ?? "",
      transporterName: order.transporterName ?? "",
      transport: order.transport ?? "",
      deliveryAddress: order.deliveryAddress ?? "",
      specialInstructions: order.specialInstructions ?? "",
      notes: order.notes ?? "",
      status: order.status,
    });
    setTaxMode(usesIgst ? "IGST" : "CGST_SGST");
    const first = order.items[0];
    setTaxRate(
      first
        ? String(usesIgst ? first.igstRate : first.cgstRate + first.sgstRate)
        : "18"
    );
    setLines(
      order.items.map((item) =>
        newLine({
          partId: item.partId ?? "",
          itemCode: item.itemCode,
          description: item.description ?? "",
          hsnCode: item.hsnCode ?? "",
          quantity: String(item.quantity),
          unit: item.unit,
          rate: String(item.rate),
          cgstRate: String(item.cgstRate),
          sgstRate: String(item.sgstRate),
          igstRate: String(item.igstRate),
          scheduleDate: dateInputValue(item.scheduleDate),
          scheduleQty: item.scheduleQty == null ? "" : String(item.scheduleQty),
        })
      )
    );
    setError("");
    setIsFormOpen(true);
  };

  /**
   * Spreads the chosen tax across every line.
   *
   * Called whenever the mode or the rate at the top changes, so the lines
   * always agree with the one choice above them. A line can still be set by
   * hand afterwards - the rate boxes stay editable - which is what an order
   * carrying two different HSN rates needs.
   */
  const applyTax = (mode: "CGST_SGST" | "IGST", rate: string) => {
    const total = num(rate);
    setLines((current) =>
      current.map((line) => ({
        ...line,
        cgstRate: mode === "CGST_SGST" ? String(total / 2) : "0",
        sgstRate: mode === "CGST_SGST" ? String(total / 2) : "0",
        igstRate: mode === "IGST" ? String(total) : "0",
      }))
    );
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  };

  /* Choosing one of our parts fills the line in; the text stays editable
     because the customer's wording is what goes on the invoice. */
  const pickPart = (key: string, partId: string) => {
    const part = parts.find((p) => p.id === partId);
    updateLine(key, {
      partId,
      ...(part
        ? {
            itemCode: part.partCode,
            description: part.name,
          }
        : {}),
    });
  };

  const draftTotals = orderTotals(
    lines.map((line) => ({
      quantity: num(line.quantity),
      rate: num(line.rate),
      cgstRate: num(line.cgstRate),
      sgstRate: num(line.sgstRate),
      igstRate: num(line.igstRate),
    }))
  );

  const handleSave = async () => {
    setIsSaving(true);
    setError("");
    try {
      const payload = {
        ...header,
        items: lines.map((line) => ({
          partId: line.partId || null,
          itemCode: line.itemCode,
          description: line.description,
          hsnCode: line.hsnCode,
          quantity: line.quantity,
          unit: line.unit,
          rate: line.rate,
          cgstRate: line.cgstRate,
          sgstRate: line.sgstRate,
          igstRate: line.igstRate,
          scheduleDate: line.scheduleDate,
          scheduleQty: line.scheduleQty,
        })),
      };

      const response = await fetch(
        editingId ? `/api/customer-orders/${editingId}` : "/api/customer-orders",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json();

      if (data.success) {
        setOrders((current) =>
          editingId
            ? current.map((o) => (o.id === editingId ? data.data : o))
            : [data.data, ...current]
        );
        setIsFormOpen(false);
        resetForm();
      } else {
        setError(data.error || "Could not save this order");
      }
    } catch {
      setError("Could not save this order");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/customer-orders/${deleting.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (data.success) {
        setOrders((current) => current.filter((o) => o.id !== deleting.id));
        setDeleting(null);
      }
    } catch (err) {
      console.error("Error removing order:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const changeStatus = async (order: CustomerOrder, status: OrderStatus) => {
    try {
      const response = await fetch(`/api/customer-orders/${order.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusOnly: true, status }),
      });
      const data = await response.json();
      if (data.success) {
        setOrders((current) =>
          current.map((o) => (o.id === order.id ? data.data : o))
        );
      }
    } catch (err) {
      console.error("Error updating status:", err);
    }
  };

  const filtered = orders.filter((order) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !query ||
      order.poNumber.toLowerCase().includes(query) ||
      order.company.name.toLowerCase().includes(query) ||
      order.referenceNo?.toLowerCase().includes(query) ||
      order.items.some(
        (item) =>
          item.itemCode.toLowerCase().includes(query) ||
          item.hsnCode?.toLowerCase().includes(query)
      );
    const matchesCustomer = !filterCustomer || order.companyId === filterCustomer;
    const matchesStatus = !filterStatus || order.status === filterStatus;
    return matchesQuery && matchesCustomer && matchesStatus;
  });

  const openOrders = orders.filter(
    (o) => o.status === "OPEN" || o.status === "PARTIAL"
  );
  const openValue = openOrders.reduce((sum, o) => sum + o.grandTotal, 0);
  const openPieces = openOrders.reduce(
    (sum, o) => sum + o.items.reduce((n, item) => n + item.quantity, 0),
    0
  );

  const selectedCustomer = customers.find((c) => c.id === header.companyId);

  if (isPageLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Customer POs
          </h1>
          <p className="text-[var(--muted-foreground)]">
            Orders our customers have sent us - what has been promised, and for
            how much
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchAll}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Link href="/customers">
            <Button variant="outline" size="sm">
              <Building2 className="mr-2 h-4 w-4" />
              Customers
            </Button>
          </Link>
          {canManage && (
            <Button onClick={openCreate} disabled={customers.length === 0}>
              <Plus className="mr-2 h-4 w-4" />
              Add Customer PO
            </Button>
          )}
        </div>
      </div>

      {customers.length === 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          No customers on file yet. Add the customer first, then their order -{" "}
          <Link href="/customers" className="font-medium underline">
            go to Customers
          </Link>
          .
        </div>
      )}

      {/* Figures across every order on file */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Orders on file",
            value: orders.length.toLocaleString("en-IN"),
            hint: "all customers, all time",
            icon: Receipt,
          },
          {
            label: "Still to supply",
            value: openOrders.length.toLocaleString("en-IN"),
            hint: "open and part-supplied",
            icon: FileText,
          },
          {
            label: "Pieces ordered",
            value: openPieces.toLocaleString("en-IN"),
            hint: "on orders not yet completed",
            icon: Package,
          },
          {
            label: "Value outstanding",
            value: formatCurrency(openValue),
            hint: "including tax",
            icon: IndianRupee,
          },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {card.label}
                  </p>
                  <p className="mt-1 truncate text-2xl font-bold">{card.value}</p>
                  <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                    {card.hint}
                  </p>
                </div>
                <div className="shrink-0 rounded-lg bg-[var(--accent)] p-3">
                  <card.icon className="h-6 w-6 text-[var(--primary)]" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search and filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Search PO number, customer, item or HSN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              options={[
                { value: "", label: "All customers" },
                ...customers.map((c) => ({ value: c.id, label: c.name })),
              ]}
              value={filterCustomer}
              onChange={setFilterCustomer}
            />
            <Select
              options={[
                { value: "", label: "Any status" },
                ...(Object.keys(STATUS_LABELS) as OrderStatus[]).map((s) => ({
                  value: s,
                  label: STATUS_LABELS[s],
                })),
              ]}
              value={filterStatus}
              onChange={setFilterStatus}
            />
          </div>
          {(searchQuery || filterCustomer || filterStatus) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setFilterCustomer("");
                setFilterStatus("");
              }}
              className="mt-3 cursor-pointer text-sm text-[var(--primary)] hover:underline"
            >
              Clear filters
            </button>
          )}
        </CardContent>
      </Card>

      {/* Order list */}
      <Card>
        <CardHeader>
          <CardTitle>Orders Received ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No customer orders found"
              description={
                canManage
                  ? "Record a purchase order a customer has sent, line by line."
                  : "No orders have been recorded yet."
              }
              action={
                canManage && customers.length > 0 ? (
                  <Button onClick={openCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Customer PO
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>PO date</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Pieces</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">Grand total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((order) => {
                  const pieces = order.items.reduce(
                    (sum, item) => sum + item.quantity,
                    0
                  );
                  return (
                    <TableRow key={order.id}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setViewing(order)}
                          className="cursor-pointer text-left font-medium text-[var(--primary)] hover:underline"
                        >
                          {order.poNumber}
                        </button>
                        {order.referenceNo && (
                          <p className="text-xs text-[var(--muted-foreground)]">
                            Ref {order.referenceNo}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{order.company.name}</p>
                        {order.company.gstNumber && (
                          <p className="font-mono text-xs text-[var(--muted-foreground)]">
                            {order.company.gstNumber}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-[var(--muted-foreground)]">
                        {formatDate(new Date(order.poDate))}
                      </TableCell>
                      <TableCell className="text-right">
                        {order.items.length}
                      </TableCell>
                      <TableCell className="text-right">
                        {pieces.toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(order.subTotal)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(order.grandTotal)}
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <Select
                            options={(Object.keys(STATUS_LABELS) as OrderStatus[]).map(
                              (s) => ({ value: s, label: STATUS_LABELS[s] })
                            )}
                            value={order.status}
                            onChange={(value) =>
                              changeStatus(order, value as OrderStatus)
                            }
                            className="h-9 w-36"
                          />
                        ) : (
                          <Badge variant={STATUS_VARIANTS[order.status]}>
                            {STATUS_LABELS[order.status]}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="View order"
                            onClick={() => setViewing(order)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {canManage && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Edit order"
                                onClick={() => openEdit(order)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Remove order"
                                onClick={() => setDeleting(order)}
                              >
                                <Trash2 className="h-4 w-4 text-[var(--error)]" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add / edit order */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          resetForm();
        }}
        title={editingId ? "Edit Customer PO" : "Add Customer PO"}
        description="Enter it exactly as it is printed on their order"
        size="full"
      >
        <div className="space-y-5">
          {error && (
            <div className="rounded-lg border border-[var(--error)] bg-[var(--error-light)] p-4 text-sm text-[var(--error)]">
              {error}
            </div>
          )}

          {/* Who sent it */}
          <div className="rounded-lg border border-[var(--border)] p-4">
            <h3 className="mb-3 text-sm font-semibold">Customer</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <Select
                label="Customer"
                placeholder="Choose the customer"
                options={customers.map((c) => ({ value: c.id, label: c.name }))}
                value={header.companyId}
                onChange={(value) => setHeader({ ...header, companyId: value })}
                className="h-12"
              />
              <Input
                label="Their PO number"
                placeholder="26001223-A"
                value={header.poNumber}
                onChange={(e) =>
                  setHeader({ ...header, poNumber: e.target.value })
                }
                className="h-12"
              />
              <Input
                label="PO date"
                type="date"
                value={header.poDate}
                onChange={(e) => setHeader({ ...header, poDate: e.target.value })}
                className="h-12"
              />
            </div>
            {selectedCustomer && (
              <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                GSTIN {selectedCustomer.gstNumber || "not on file"}
                {selectedCustomer.stateCode
                  ? ` · State code ${selectedCustomer.stateCode}`
                  : ""}
                {selectedCustomer.contactPerson
                  ? ` · ${selectedCustomer.contactPerson}`
                  : ""}
              </p>
            )}
          </div>

          {/* The rest of their header block */}
          <div className="rounded-lg border border-[var(--border)] p-4">
            <h3 className="mb-3 text-sm font-semibold">Order details</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <Input
                label="Reference no. (optional)"
                placeholder="GDC CASTING -4/12 HHM MAIL"
                value={header.referenceNo}
                onChange={(e) =>
                  setHeader({ ...header, referenceNo: e.target.value })
                }
                className="h-12"
              />
              <Input
                label="Reference date"
                type="date"
                value={header.referenceDate}
                onChange={(e) =>
                  setHeader({ ...header, referenceDate: e.target.value })
                }
                className="h-12"
              />
              <Input
                label="Payment terms"
                placeholder="45 Days Credit"
                value={header.paymentTerms}
                onChange={(e) =>
                  setHeader({ ...header, paymentTerms: e.target.value })
                }
                className="h-12"
              />
              <Input
                label="Transport"
                placeholder="your account"
                value={header.transport}
                onChange={(e) =>
                  setHeader({ ...header, transport: e.target.value })
                }
                className="h-12"
              />
              <Select
                label="Status"
                options={(Object.keys(STATUS_LABELS) as OrderStatus[]).map((s) => ({
                  value: s,
                  label: STATUS_LABELS[s],
                }))}
                value={header.status}
                onChange={(value) =>
                  setHeader({ ...header, status: value as OrderStatus })
                }
                className="h-12"
              />
              <div className="md:col-span-3">
                <Textarea
                  label="Deliver at"
                  placeholder="Only if it differs from their registered address"
                  value={header.deliveryAddress}
                  onChange={(e) =>
                    setHeader({ ...header, deliveryAddress: e.target.value })
                  }
                  className="min-h-[70px]"
                />
              </div>
            </div>
          </div>

          {/* Tax, chosen once for the whole order */}
          <div className="rounded-lg border border-[var(--border)] p-4">
            <h3 className="mb-3 text-sm font-semibold">Tax</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <Select
                label="Which tax applies"
                options={[
                  { value: "CGST_SGST", label: "CGST + SGST (same state)" },
                  { value: "IGST", label: "IGST (other state)" },
                ]}
                value={taxMode}
                onChange={(value) => {
                  const mode = value as "CGST_SGST" | "IGST";
                  setTaxMode(mode);
                  applyTax(mode, taxRate);
                }}
                className="h-12"
              />
              <Input
                label="Total GST %"
                type="number"
                value={taxRate}
                onChange={(e) => {
                  setTaxRate(e.target.value);
                  applyTax(taxMode, e.target.value);
                }}
                className="h-12"
              />
              <div className="flex items-end">
                <p className="text-sm text-[var(--muted-foreground)]">
                  {taxMode === "CGST_SGST"
                    ? `Split ${num(taxRate) / 2}% CGST + ${num(taxRate) / 2}% SGST on every line`
                    : `${num(taxRate)}% IGST on every line`}
                  . A line can still be changed on its own below.
                </p>
              </div>
            </div>
          </div>

          {/* The lines off their order */}
          <div className="rounded-lg border border-[var(--border)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Items ({lines.length})
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setLines([
                    ...lines,
                    newLine({
                      cgstRate:
                        taxMode === "CGST_SGST" ? String(num(taxRate) / 2) : "0",
                      sgstRate:
                        taxMode === "CGST_SGST" ? String(num(taxRate) / 2) : "0",
                      igstRate: taxMode === "IGST" ? String(num(taxRate)) : "0",
                    }),
                  ])
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Add item
              </Button>
            </div>

            <div className="space-y-4">
              {lines.map((line, index) => {
                const amounts = lineAmounts({
                  quantity: num(line.quantity),
                  rate: num(line.rate),
                  cgstRate: num(line.cgstRate),
                  sgstRate: num(line.sgstRate),
                  igstRate: num(line.igstRate),
                });

                return (
                  <div
                    key={line.key}
                    className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-semibold">
                        Sr. No. {index + 1}
                      </span>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          title="Remove this item"
                          onClick={() =>
                            setLines(lines.filter((l) => l.key !== line.key))
                          }
                          className="cursor-pointer rounded p-1 text-[var(--error)] hover:bg-[var(--error-light)]"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <Input
                        label="Item code"
                        placeholder="MAG-701-1109-02"
                        value={line.itemCode}
                        onChange={(e) =>
                          updateLine(line.key, { itemCode: e.target.value })
                        }
                      />
                      <Select
                        label="Our part (optional)"
                        options={[
                          { value: "", label: "Not matched yet" },
                          ...parts.map((p) => ({
                            value: p.id,
                            label: `${p.partCode} - ${p.name}`,
                          })),
                        ]}
                        value={line.partId}
                        onChange={(value) => pickPart(line.key, value)}
                      />
                      <Input
                        label="HSN code"
                        placeholder="76090000"
                        value={line.hsnCode}
                        onChange={(e) =>
                          updateLine(line.key, { hsnCode: e.target.value })
                        }
                      />
                      <div className="md:col-span-3">
                        <Input
                          label="Part details"
                          placeholder="Part No.701-1109 Extension Flange Grade. LM6"
                          value={line.description}
                          onChange={(e) =>
                            updateLine(line.key, { description: e.target.value })
                          }
                        />
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-4">
                      <Input
                        label="Quantity"
                        type="number"
                        placeholder="10"
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(line.key, { quantity: e.target.value })
                        }
                      />
                      <Input
                        label="Unit"
                        placeholder="NOS"
                        value={line.unit}
                        onChange={(e) =>
                          updateLine(line.key, { unit: e.target.value })
                        }
                      />
                      <Input
                        label="Rate / unit (INR)"
                        type="number"
                        placeholder="548.00"
                        value={line.rate}
                        onChange={(e) =>
                          updateLine(line.key, { rate: e.target.value })
                        }
                      />
                      <div>
                        <p className="mb-1.5 text-sm font-medium">Amount</p>
                        <div className="flex h-10 items-center rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 text-sm font-semibold">
                          {formatCurrency(amounts.amount)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-4">
                      {taxMode === "CGST_SGST" ? (
                        <>
                          <Input
                            label="CGST %"
                            type="number"
                            value={line.cgstRate}
                            onChange={(e) =>
                              updateLine(line.key, { cgstRate: e.target.value })
                            }
                          />
                          <div>
                            <p className="mb-1.5 text-sm font-medium">
                              CGST amount
                            </p>
                            <div className="flex h-10 items-center rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 text-sm">
                              {formatCurrency(amounts.cgstAmount)}
                            </div>
                          </div>
                          <Input
                            label="SGST %"
                            type="number"
                            value={line.sgstRate}
                            onChange={(e) =>
                              updateLine(line.key, { sgstRate: e.target.value })
                            }
                          />
                          <div>
                            <p className="mb-1.5 text-sm font-medium">
                              SGST amount
                            </p>
                            <div className="flex h-10 items-center rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 text-sm">
                              {formatCurrency(amounts.sgstAmount)}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <Input
                            label="IGST %"
                            type="number"
                            value={line.igstRate}
                            onChange={(e) =>
                              updateLine(line.key, { igstRate: e.target.value })
                            }
                          />
                          <div>
                            <p className="mb-1.5 text-sm font-medium">
                              IGST amount
                            </p>
                            <div className="flex h-10 items-center rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 text-sm">
                              {formatCurrency(amounts.igstAmount)}
                            </div>
                          </div>
                        </>
                      )}
                      <Input
                        label="Schedule date (optional)"
                        type="date"
                        value={line.scheduleDate}
                        onChange={(e) =>
                          updateLine(line.key, { scheduleDate: e.target.value })
                        }
                      />
                      <Input
                        label="Schedule qty (optional)"
                        type="number"
                        value={line.scheduleQty}
                        onChange={(e) =>
                          updateLine(line.key, { scheduleQty: e.target.value })
                        }
                      />
                    </div>

                    <p className="mt-3 text-sm font-medium text-[var(--primary)]">
                      Line total with tax: {formatCurrency(amounts.lineTotal)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* What it comes to - the same arithmetic the server will redo */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-4">
            <div className="grid gap-2 text-sm md:grid-cols-2">
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">
                    Total in INR (taxable)
                  </span>
                  <span className="font-medium">
                    {formatCurrency(draftTotals.subTotal)}
                  </span>
                </div>
                {taxMode === "CGST_SGST" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted-foreground)]">CGST</span>
                      <span className="font-medium">
                        {formatCurrency(draftTotals.cgstAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted-foreground)]">SGST</span>
                      <span className="font-medium">
                        {formatCurrency(draftTotals.sgstAmount)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between">
                    <span className="text-[var(--muted-foreground)]">IGST</span>
                    <span className="font-medium">
                      {formatCurrency(draftTotals.igstAmount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-[var(--border)] pt-1 text-base">
                  <span className="font-semibold">Grand total in INR</span>
                  <span className="font-bold">
                    {formatCurrency(draftTotals.grandTotal)}
                  </span>
                </div>
              </div>
              <div className="flex items-end">
                <p className="text-xs text-[var(--muted-foreground)]">
                  Amount in words: {rupeesInWords(draftTotals.grandTotal)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Textarea
              label="Special instructions"
              placeholder="As printed on their order"
              value={header.specialInstructions}
              onChange={(e) =>
                setHeader({ ...header, specialInstructions: e.target.value })
              }
              className="min-h-[70px]"
            />
            <Textarea
              label="Our notes"
              placeholder="Anything the shop needs to know"
              value={header.notes}
              onChange={(e) => setHeader({ ...header, notes: e.target.value })}
              className="min-h-[70px]"
            />
          </div>
        </div>

        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => {
              setIsFormOpen(false);
              resetForm();
            }}
          >
            Cancel
          </Button>
          <Button
            className="h-12"
            onClick={handleSave}
            isLoading={isSaving}
            disabled={
              !header.companyId ||
              !header.poNumber.trim() ||
              lines.every((l) => !l.itemCode.trim())
            }
          >
            {editingId ? "Save Changes" : "Save Order"}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Read an order back the way it was printed */}
      <Modal
        isOpen={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? `PO ${viewing.poNumber}` : "Order"}
        description={viewing?.company.name}
        size="full"
      >
        {viewing && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-[var(--border)] p-4 text-sm">
                <p className="mb-2 font-semibold">From</p>
                <p className="font-medium">{viewing.company.name}</p>
                {viewing.company.address && (
                  <p className="text-[var(--muted-foreground)]">
                    {viewing.company.address}
                  </p>
                )}
                {(viewing.company.city || viewing.company.state) && (
                  <p className="text-[var(--muted-foreground)]">
                    {[viewing.company.city, viewing.company.state, viewing.company.pincode]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
                {viewing.company.gstNumber && (
                  <p className="mt-1 font-mono text-xs">
                    GSTIN {viewing.company.gstNumber}
                    {viewing.company.stateCode
                      ? ` · State code ${viewing.company.stateCode}`
                      : ""}
                  </p>
                )}
                {viewing.company.contactPerson && (
                  <p className="mt-1 text-[var(--muted-foreground)]">
                    {viewing.company.contactPerson}
                    {viewing.company.phone ? ` · ${viewing.company.phone}` : ""}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-[var(--border)] p-4 text-sm">
                <p className="mb-2 font-semibold">Order</p>
                <dl className="grid grid-cols-2 gap-y-1">
                  <dt className="text-[var(--muted-foreground)]">PO no.</dt>
                  <dd className="font-medium">{viewing.poNumber}</dd>
                  <dt className="text-[var(--muted-foreground)]">PO date</dt>
                  <dd>{formatDate(new Date(viewing.poDate))}</dd>
                  {viewing.referenceNo && (
                    <>
                      <dt className="text-[var(--muted-foreground)]">
                        Reference
                      </dt>
                      <dd>{viewing.referenceNo}</dd>
                    </>
                  )}
                  {viewing.referenceDate && (
                    <>
                      <dt className="text-[var(--muted-foreground)]">
                        Reference date
                      </dt>
                      <dd>{formatDate(new Date(viewing.referenceDate))}</dd>
                    </>
                  )}
                  {viewing.paymentTerms && (
                    <>
                      <dt className="text-[var(--muted-foreground)]">
                        Payment terms
                      </dt>
                      <dd>{viewing.paymentTerms}</dd>
                    </>
                  )}
                  {viewing.transporterName && (
                    <>
                      <dt className="text-[var(--muted-foreground)]">
                        Transporter
                      </dt>
                      <dd>{viewing.transporterName}</dd>
                    </>
                  )}
                  {viewing.transport && (
                    <>
                      <dt className="text-[var(--muted-foreground)]">
                        Transport
                      </dt>
                      <dd>{viewing.transport}</dd>
                    </>
                  )}
                  <dt className="text-[var(--muted-foreground)]">Status</dt>
                  <dd>
                    <Badge variant={STATUS_VARIANTS[viewing.status]}>
                      {STATUS_LABELS[viewing.status]}
                    </Badge>
                  </dd>
                </dl>
              </div>
            </div>

            {viewing.deliveryAddress && (
              <div className="rounded-lg border border-[var(--border)] p-4 text-sm">
                <p className="mb-1 font-semibold">Deliver at</p>
                <p className="text-[var(--muted-foreground)]">
                  {viewing.deliveryAddress}
                </p>
              </div>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Sr.</TableHead>
                  <TableHead>Item details</TableHead>
                  <TableHead>HSN code</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Rate / unit</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST</TableHead>
                  <TableHead className="text-right">IGST</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewing.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.sequence}</TableCell>
                    <TableCell>
                      <p className="font-medium">{item.itemCode}</p>
                      {item.description && (
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {item.description}
                        </p>
                      )}
                      {item.part && (
                        <p className="text-xs text-[var(--primary)]">
                          Our part {item.part.partCode}
                        </p>
                      )}
                      {item.scheduleDate && (
                        <p className="text-xs text-[var(--muted-foreground)]">
                          Sch. {formatDate(new Date(item.scheduleDate))}
                          {item.scheduleQty
                            ? ` · ${item.scheduleQty} ${item.unit}`
                            : ""}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.hsnCode || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.quantity.toLocaleString("en-IN")} {item.unit}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.rate)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(item.amount)}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {item.cgstRate}% · {formatCurrency(item.cgstAmount)}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {item.sgstRate}% · {formatCurrency(item.sgstAmount)}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {item.igstRate}% · {formatCurrency(item.igstAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">
                  Total in INR
                </span>
                <span className="font-medium">
                  {formatCurrency(viewing.subTotal)}
                </span>
              </div>
              {viewing.cgstAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">CGST</span>
                  <span className="font-medium">
                    {formatCurrency(viewing.cgstAmount)}
                  </span>
                </div>
              )}
              {viewing.sgstAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">SGST</span>
                  <span className="font-medium">
                    {formatCurrency(viewing.sgstAmount)}
                  </span>
                </div>
              )}
              {viewing.igstAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">IGST</span>
                  <span className="font-medium">
                    {formatCurrency(viewing.igstAmount)}
                  </span>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t border-[var(--border)] pt-2 text-base">
                <span className="font-semibold">Grand total in INR</span>
                <span className="font-bold">
                  {formatCurrency(viewing.grandTotal)}
                </span>
              </div>
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                Amount in words: {rupeesInWords(viewing.grandTotal)}
              </p>
            </div>

            {(viewing.specialInstructions || viewing.notes) && (
              <div className="grid gap-4 md:grid-cols-2 text-sm">
                {viewing.specialInstructions && (
                  <div className="rounded-lg border border-[var(--border)] p-4">
                    <p className="mb-1 font-semibold">Special instructions</p>
                    <p className="text-[var(--muted-foreground)]">
                      {viewing.specialInstructions}
                    </p>
                  </div>
                )}
                {viewing.notes && (
                  <div className="rounded-lg border border-[var(--border)] p-4">
                    <p className="mb-1 font-semibold">Our notes</p>
                    <p className="text-[var(--muted-foreground)]">
                      {viewing.notes}
                    </p>
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-[var(--muted-foreground)]">
              Recorded by {viewing.user?.name ?? "-"} on{" "}
              {formatDate(new Date(viewing.createdAt))}
            </p>
          </div>
        )}
        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => setViewing(null)}
          >
            Close
          </Button>
          {canManage && viewing && (
            <Button
              className="h-12"
              onClick={() => {
                const order = viewing;
                setViewing(null);
                openEdit(order);
              }}
            >
              <Edit className="mr-2 h-4 w-4" />
              Edit Order
            </Button>
          )}
        </ModalFooter>
      </Modal>

      {/* Remove */}
      <Modal
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Remove Order"
        size="sm"
      >
        <div className="pb-2">
          <p className="text-[var(--muted-foreground)]">
            Remove PO{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {deleting?.poNumber}
            </span>{" "}
            from {deleting?.company.name}, with all its items? This cannot be
            undone. An order that was withdrawn is better marked Cancelled.
          </p>
        </div>
        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => setDeleting(null)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="h-12"
            onClick={handleDelete}
            isLoading={isSaving}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Remove
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
