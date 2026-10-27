"use client";

import * as React from "react";
import Link from "next/link";
import {
  Truck,
  Search,
  RefreshCw,
  Plus,
  PackageCheck,
  Hourglass,
  Building2,
  X,
  Trash2,
  Eye,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { cn, formatDate, formatWeight } from "@/lib/utils";
import { canWrite, canReverseOutward } from "@/lib/permissions";
import type { UserRole } from "@/types";

/**
 * Customer outward - what is ready for each customer, and what has gone.
 *
 * Read by Accounts, who answer for what has been delivered and what is still
 * owed, so the page is built around that one question rather than around the
 * shop floor.
 *
 * Recording an outward note takes the pieces OUT of finished stock. It is the
 * only thing that does, which is why "ready" here can be trusted against the
 * shelf.
 */

interface CustomerPart {
  partId: string;
  partCode: string;
  name: string;
  ordered: number;
  dispatched: number;
  outstanding: number;
  readyInStock: number;
  orders: number;
  weightPerPiece: number;
}

interface CustomerRow {
  id: string;
  name: string;
  gstNumber: string | null;
  city: string | null;
  state: string | null;
  parts: CustomerPart[];
  ordered: number;
  dispatched: number;
  outstanding: number;
  canLoadNow: number;
  dispatchCount: number;
  lastDispatchDate: string | null;
}

/** A shop floor person named on a note - they do not log in, so not a user. */
interface EmployeeRef {
  id: string;
  employeeCode: string;
  name: string;
}

interface OutwardNote {
  id: string;
  dispatchNumber: string;
  dispatchDate: string;
  company: { id: string; name: string; gstNumber: string | null };
  customerOrder: { id: string; poNumber: string } | null;
  vehicleNumber: string | null;
  driverName: string | null;
  invoiceNumber: string | null;
  supervisor: EmployeeRef | null;
  qcCheckedBy: EmployeeRef | null;
  notes: string | null;
  recordedBy: string | null;
  items: Array<{
    id: string;
    partId: string;
    partCode: string;
    name: string;
    quantity: number;
    weight: number;
  }>;
  totalPieces: number;
  totalWeight: number;
}

interface OutwardData {
  customers: CustomerRow[];
  allCustomers: Array<{ id: string; name: string }>;
  dispatches: OutwardNote[];
  readyStock: Array<{ partId: string; ready: number }>;
}

interface DraftLine {
  key: string;
  partId: string;
  quantity: string;
}

let lineCounter = 0;
function newLine(partId = ""): DraftLine {
  lineCounter += 1;
  return { key: `out-${lineCounter}`, partId, quantity: "" };
}

function nos(value: number): string {
  return value.toLocaleString("en-IN");
}

export default function CustomerOutwardPage() {
  const [data, setData] = React.useState<OutwardData | null>(null);
  const [employees, setEmployees] = React.useState<EmployeeRef[]>([]);
  const [orders, setOrders] = React.useState<
    Array<{ id: string; poNumber: string; companyId: string }>
  >([]);
  const [isPageLoading, setIsPageLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  const [tab, setTab] = React.useState<"customers" | "notes">("customers");
  const [search, setSearch] = React.useState("");
  const [detail, setDetail] = React.useState<CustomerRow | null>(null);
  const [viewNote, setViewNote] = React.useState<OutwardNote | null>(null);
  const [cancelNote, setCancelNote] = React.useState<OutwardNote | null>(null);

  const [role, setRole] = React.useState<UserRole | null>(null);
  const canManage = role ? canWrite({ role }, "customerOrders") : false;
  const canCancel = role ? canReverseOutward({ role }) : false;

  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    companyId: "",
    customerOrderId: "",
    dispatchDate: new Date().toISOString().slice(0, 10),
    invoiceNumber: "",
    supervisorId: "",
    qcCheckedById: "",
    vehicleNumber: "",
    driverName: "",
    notes: "",
  });
  const [lines, setLines] = React.useState<DraftLine[]>([newLine()]);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const payload = await res.json();
        if (payload.success) setRole(payload.user.role);
      } catch {
        // A failed read leaves the page read-only, which is the safe way round
      }
    })();
  }, []);

  const fetchAll = React.useCallback(async () => {
    setIsPageLoading(true);
    try {
      // The part catalogue is not read here any more: the outward form only
      // offers what the chosen customer has on order, and that comes back
      // with the outward data itself.
      const [outwardRes, orderRes, employeeRes] = await Promise.all([
        fetch("/api/customer-outward"),
        fetch("/api/customer-orders"),
        // Active employees only - the two names on a note are people who are
        // still on the books
        fetch("/api/employees"),
      ]);

      const outwardData = await outwardRes.json();
      if (outwardData.success) setData(outwardData.data);

      if (employeeRes.ok) {
        const employeeData = await employeeRes.json();
        if (employeeData.success) setEmployees(employeeData.data ?? []);
      }
      if (orderRes.ok) {
        const orderData = await orderRes.json();
        if (orderData.success) {
          setOrders(
            (orderData.data as Array<{ id: string; poNumber: string; companyId: string; status: string }>)
              .filter((o) => o.status !== "CANCELLED")
              .map((o) => ({ id: o.id, poNumber: o.poNumber, companyId: o.companyId }))
          );
        }
      }
    } catch (err) {
      console.error("Error loading customer outward:", err);
    } finally {
      setIsPageLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /** Finished stock per part, for the hints on the outward form. */
  const readyByPart = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const row of data?.readyStock ?? []) map.set(row.partId, row.ready);
    return map;
  }, [data]);

  /**
   * The parts this customer has on order - the only ones the form offers.
   *
   * A load is always against something they asked for, so the picker is their
   * order book rather than the whole catalogue: it is shorter, it carries the
   * outstanding count, and it makes loading a part against the wrong customer
   * impossible instead of merely unlikely. A part shows even with nothing
   * finished - "120 owed, 0 finished" is worth seeing, and the per-line stock
   * hint refuses the quantity anyway.
   */
  const orderedParts = React.useMemo(() => {
    const row = data?.customers.find((c) => c.id === form.companyId);
    return (row?.parts ?? []).filter((p) => p.ordered > 0);
  }, [data, form.companyId]);

  const openForm = (customerId?: string, partId?: string) => {
    setForm({
      companyId: customerId ?? "",
      customerOrderId: "",
      dispatchDate: new Date().toISOString().slice(0, 10),
      invoiceNumber: "",
      supervisorId: "",
      qcCheckedById: "",
      vehicleNumber: "",
      driverName: "",
      notes: "",
    });
    setLines([newLine(partId ?? "")]);
    setError("");
    setIsFormOpen(true);
  };

  /*
   * Arriving from the dashboard's details popup opens the form already on
   * that part - the person clicked "Outward" meaning to send it, not to read
   * another list. Done once, and only for someone who may record one.
   */
  const [deepLinkPart, setDeepLinkPart] = React.useState<string | null>(null);
  const deepLinkUsed = React.useRef(false);

  React.useEffect(() => {
    setDeepLinkPart(new URLSearchParams(window.location.search).get("part"));
  }, []);

  React.useEffect(() => {
    if (!deepLinkPart || deepLinkUsed.current || !canManage || !data) return;
    deepLinkUsed.current = true;
    openForm(undefined, deepLinkPart);
  }, [deepLinkPart, canManage, data]);

  const handleSave = async () => {
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch("/api/customer-outward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          customerOrderId: form.customerOrderId || null,
          items: lines
            .filter((line) => line.partId && line.quantity)
            .map((line) => ({ partId: line.partId, quantity: line.quantity })),
        }),
      });
      const payload = await response.json();
      if (payload.success) {
        setIsFormOpen(false);
        setDetail(null);
        await fetchAll();
      } else {
        setError(payload.error || "Could not record this outward note");
      }
    } catch {
      setError("Could not record this outward note");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelNote) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/customer-outward/${cancelNote.id}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (payload.success) {
        setCancelNote(null);
        await fetchAll();
      }
    } catch (err) {
      console.error("Error cancelling outward note:", err);
    } finally {
      setIsSaving(false);
    }
  };

  if (isPageLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState
            icon={Truck}
            title="Outward is not available"
            description="You do not have access to customer deliveries."
          />
        </CardContent>
      </Card>
    );
  }

  const query = search.trim().toLowerCase();
  const customers = data.customers.filter(
    (customer) =>
      !query ||
      customer.name.toLowerCase().includes(query) ||
      customer.parts.some(
        (part) =>
          part.name.toLowerCase().includes(query) ||
          part.partCode.toLowerCase().includes(query)
      )
  );
  const notes = data.dispatches.filter(
    (note) =>
      !query ||
      note.dispatchNumber.toLowerCase().includes(query) ||
      note.invoiceNumber?.toLowerCase().includes(query) ||
      note.supervisor?.name.toLowerCase().includes(query) ||
      note.qcCheckedBy?.name.toLowerCase().includes(query) ||
      note.company.name.toLowerCase().includes(query) ||
      note.items.some((item) => item.partCode.toLowerCase().includes(query))
  );

  const totals = {
    outstanding: data.customers.reduce((sum, c) => sum + c.outstanding, 0),
    canLoadNow: data.customers.reduce((sum, c) => sum + c.canLoadNow, 0),
    sent: data.dispatches.reduce((sum, n) => sum + n.totalPieces, 0),
    weight: data.dispatches.reduce((sum, n) => sum + n.totalWeight, 0),
  };

  const ordersForCustomer = orders.filter((o) => o.companyId === form.companyId);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Customer Outward
          </h1>
          <p className="text-[var(--muted-foreground)]">
            Customer by customer: what is finished and waiting, and what has
            already gone out
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchAll}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Link href="/customer-orders">
            <Button variant="outline" size="sm">
              <Receipt className="mr-2 h-4 w-4" />
              Customer POs
            </Button>
          </Link>
          {canManage && (
            <Button onClick={() => openForm()}>
              <Plus className="mr-2 h-4 w-4" />
              Record Outward
            </Button>
          )}
        </div>
      </div>

      {/* Headline figures */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Customers waiting",
            value: nos(data.customers.filter((c) => c.outstanding > 0).length),
            hint: "with pieces still owed",
            icon: Building2,
          },
          {
            label: "Pieces still owed",
            value: nos(totals.outstanding),
            hint: "ordered and not yet sent",
            icon: Hourglass,
          },
          {
            label: "Can be loaded today",
            value: nos(totals.canLoadNow),
            hint: "owed, and finished on the shelf",
            icon: PackageCheck,
          },
          {
            label: "Sent out",
            value: nos(totals.sent),
            hint: `${formatWeight(totals.weight)} on ${data.dispatches.length} note${data.dispatches.length === 1 ? "" : "s"}`,
            icon: Truck,
          },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {card.label}
                  </p>
                  <p className="mt-1 text-3xl font-bold">{card.value}</p>
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

      {/* Which list, and a search across both */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-lg border border-[var(--border)] p-1">
              {[
                { key: "customers" as const, label: "By customer" },
                { key: "notes" as const, label: `Outward notes (${data.dispatches.length})` },
              ].map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setTab(entry.key)}
                  className={cn(
                    "cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-colors",
                    tab === entry.key
                      ? "bg-[var(--primary)] text-white"
                      : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Search customer, part or note..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {tab === "customers" ? (
        <Card>
          <CardHeader>
            <CardTitle>Ready and gone, by customer</CardTitle>
          </CardHeader>
          <CardContent>
            {customers.length === 0 ? (
              <EmptyState
                icon={Truck}
                title="Nothing to show yet"
                description="Once a customer PO names one of our parts, what they are owed appears here."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Parts</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Sent out</TableHead>
                    <TableHead className="text-right">Still owed</TableHead>
                    <TableHead className="text-right">Ready to load</TableHead>
                    <TableHead>Last sent</TableHead>
                    <TableHead className="text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <p className="font-medium">{customer.name}</p>
                        {customer.city && (
                          <p className="text-xs text-[var(--muted-foreground)]">
                            {customer.city}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {customer.parts.length}
                      </TableCell>
                      <TableCell className="text-right">
                        {nos(customer.ordered)}
                      </TableCell>
                      <TableCell className="text-right">
                        {nos(customer.dispatched)}
                      </TableCell>
                      <TableCell className="text-right">
                        {customer.outstanding > 0 ? (
                          <span className="font-semibold text-amber-700">
                            {nos(customer.outstanding)}
                          </span>
                        ) : (
                          <Badge variant="success">Clear</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {customer.canLoadNow > 0 ? (
                          <span className="font-semibold text-green-700">
                            {nos(customer.canLoadNow)}
                          </span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-[var(--muted-foreground)]">
                        {customer.lastDispatchDate
                          ? formatDate(new Date(customer.lastDispatchDate))
                          : "never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetail(customer)}
                        >
                          <Eye className="mr-1.5 h-4 w-4" />
                          Part-wise
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Outward notes</CardTitle>
          </CardHeader>
          <CardContent>
            {notes.length === 0 ? (
              <EmptyState
                icon={Truck}
                title="No outward notes yet"
                description="Record one when finished castings leave the yard - the pieces come off finished stock as it is saved."
                action={
                  canManage ? (
                    <Button onClick={() => openForm()}>
                      <Plus className="mr-2 h-4 w-4" />
                      Record Outward
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Note</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Against PO</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead className="text-right">Pieces</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notes.map((note) => (
                    <TableRow key={note.id}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setViewNote(note)}
                          className="cursor-pointer font-medium text-[var(--primary)] hover:underline"
                        >
                          {note.dispatchNumber}
                        </button>
                        {/*
                          * Who stood behind the load, under the number rather
                          * than in two more columns - the table is already
                          * wide, and this is what someone scans for when a
                          * customer rings about a load.
                          */}
                        {(note.supervisor || note.qcCheckedBy) && (
                          <p className="text-xs text-[var(--muted-foreground)]">
                            {note.supervisor
                              ? `Sup ${note.supervisor.name}`
                              : "Sup -"}
                            {" · "}
                            {note.qcCheckedBy
                              ? `QC ${note.qcCheckedBy.name}`
                              : "QC -"}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-[var(--muted-foreground)]">
                        {formatDate(new Date(note.dispatchDate))}
                      </TableCell>
                      <TableCell>{note.company.name}</TableCell>
                      <TableCell className="text-sm">
                        {note.customerOrder?.poNumber ?? (
                          <span className="text-[var(--muted-foreground)]">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {note.invoiceNumber ?? (
                          <span className="text-[var(--muted-foreground)]">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {nos(note.totalPieces)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatWeight(note.totalWeight)}
                      </TableCell>
                      <TableCell className="text-sm text-[var(--muted-foreground)]">
                        {note.vehicleNumber || "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="View note"
                            onClick={() => setViewNote(note)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {canCancel && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Cancel note and put the pieces back"
                              onClick={() => setCancelNote(note)}
                            >
                              <Trash2 className="h-4 w-4 text-[var(--error)]" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* One customer, part by part */}
      <Modal
        isOpen={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.name ?? "Customer"}
        description={
          detail
            ? `${nos(detail.ordered)} ordered · ${nos(detail.dispatched)} sent · ${nos(detail.outstanding)} still owed`
            : undefined
        }
        size="xl"
      >
        {detail && (
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part</TableHead>
                  <TableHead className="text-right">POs</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Sent out</TableHead>
                  <TableHead className="text-right">Still owed</TableHead>
                  <TableHead className="text-right">Finished in stock</TableHead>
                  <TableHead className="text-right">Can load</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.parts.map((part) => {
                  const canLoad = Math.min(part.outstanding, part.readyInStock);
                  return (
                    <TableRow key={part.partId}>
                      <TableCell>
                        <p className="font-medium">{part.name}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {part.partCode} · {formatWeight(part.weightPerPiece)} each
                        </p>
                      </TableCell>
                      <TableCell className="text-right">{part.orders}</TableCell>
                      <TableCell className="text-right">
                        {nos(part.ordered)}
                      </TableCell>
                      <TableCell className="text-right">
                        {nos(part.dispatched)}
                      </TableCell>
                      <TableCell className="text-right">
                        {part.outstanding > 0 ? (
                          <span className="font-semibold text-amber-700">
                            {nos(part.outstanding)}
                          </span>
                        ) : (
                          <Badge variant="success">Clear</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {nos(part.readyInStock)}
                      </TableCell>
                      <TableCell className="text-right">
                        {canLoad > 0 ? (
                          <span className="font-semibold text-green-700">
                            {nos(canLoad)}
                          </span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="text-xs text-[var(--muted-foreground)]">
              Finished stock is held per part, not reserved per customer - the
              same pieces appear against every customer who has ordered that
              part, and go to whoever is loaded first.
            </p>
          </div>
        )}
        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => setDetail(null)}
          >
            Close
          </Button>
          {canManage && detail && (
            <Button
              className="h-12"
              onClick={() => {
                const customerId = detail.id;
                const firstLoadable = detail.parts.find(
                  (p) => Math.min(p.outstanding, p.readyInStock) > 0
                );
                setDetail(null);
                openForm(customerId, firstLoadable?.partId);
              }}
            >
              <Truck className="mr-2 h-4 w-4" />
              Record Outward
            </Button>
          )}
        </ModalFooter>
      </Modal>

      {/* Record an outward note */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title="Record Outward"
        description="Saving this takes the pieces out of finished stock"
        size="xl"
      >
        <div className="space-y-5">
          {error && (
            <div className="rounded-lg border border-[var(--error)] bg-[var(--error-light)] p-4 text-sm text-[var(--error)]">
              {error}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Select
              label="Customer"
              placeholder="Choose the customer"
              options={data.allCustomers.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
              value={form.companyId}
              onChange={(value) => {
                setForm({ ...form, companyId: value, customerOrderId: "" });
                /*
                 * Lines keyed against the previous customer are cleared, not
                 * carried over - the new customer may not have ordered that
                 * part at all, and a part sitting in a line that is no longer
                 * in the list reads as an empty box.
                 */
                const allowed = new Set(
                  (data.customers.find((c) => c.id === value)?.parts ?? [])
                    .filter((p) => p.ordered > 0)
                    .map((p) => p.partId)
                );
                setLines((current) =>
                  current.map((l) =>
                    l.partId && !allowed.has(l.partId) ? { ...l, partId: "" } : l
                  )
                );
              }}
              className="h-12"
            />
            <Select
              label="Against PO (optional)"
              options={[
                { value: "", label: "No PO / call-off" },
                ...ordersForCustomer.map((o) => ({
                  value: o.id,
                  label: o.poNumber,
                })),
              ]}
              value={form.customerOrderId}
              onChange={(value) => setForm({ ...form, customerOrderId: value })}
              className="h-12"
            />
            {/*
              * Optional, and on purpose: a load often leaves on a delivery
              * challan and is invoiced afterwards. It can be filled in on the
              * note later rather than holding up the dispatch.
              */}
            <Input
              label="Invoice number (optional)"
              placeholder="e.g. MM/26-27/104"
              value={form.invoiceNumber}
              onChange={(e) =>
                setForm({ ...form, invoiceNumber: e.target.value })
              }
              className="h-12"
            />
            <Input
              label="Date sent"
              type="date"
              value={form.dispatchDate}
              onChange={(e) =>
                setForm({ ...form, dispatchDate: e.target.value })
              }
              className="h-12"
            />
            {/*
              * Vehicle and driver are both optional - plenty goes out by hand
              * or on the customer's own transport. The driver box only
              * appears once a vehicle is named, and clearing the vehicle
              * clears the driver with it, so a name can never be recorded
              * against no vehicle.
              */}
            <Input
              label="Vehicle number (optional)"
              placeholder="MH 12 AB 1234"
              value={form.vehicleNumber}
              onChange={(e) => {
                const vehicleNumber = e.target.value;
                setForm({
                  ...form,
                  vehicleNumber,
                  driverName: vehicleNumber.trim() ? form.driverName : "",
                });
              }}
              className="h-12"
            />
            {form.vehicleNumber.trim() !== "" && (
              <Input
                label="Driver (optional)"
                placeholder="Driver name"
                value={form.driverName}
                onChange={(e) =>
                  setForm({ ...form, driverName: e.target.value })
                }
                className="h-12"
              />
            )}
            <Input
              label="Notes"
              placeholder="Anything to record"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="h-12"
            />
          </div>

          {/*
            * The two people answerable for the load, kept in their own block
            * because they are signatures rather than transport details: who
            * stood over the loading, and who passed the castings on quality.
            * Employees, not users - neither of them logs in.
            *
            * Left optional on purpose. A load that has physically left has to
            * be recordable even when the clerk does not yet know who checked
            * it, otherwise the honest outcome is that nobody records it at all
            * and finished stock stays wrong.
            */}
          <div className="rounded-lg border border-[var(--border)] p-4">
            <h3 className="mb-3 text-sm font-semibold">Signed off by</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Dispatch supervisor"
                options={[
                  { value: "", label: "Not recorded" },
                  ...employees.map((e) => ({
                    value: e.id,
                    label: `${e.employeeCode} - ${e.name}`,
                  })),
                ]}
                value={form.supervisorId}
                onChange={(value) => setForm({ ...form, supervisorId: value })}
                className="h-12"
              />
              <Select
                label="QC - quality checked by"
                options={[
                  { value: "", label: "Not recorded" },
                  ...employees.map((e) => ({
                    value: e.id,
                    label: `${e.employeeCode} - ${e.name}`,
                  })),
                ]}
                value={form.qcCheckedById}
                onChange={(value) => setForm({ ...form, qcCheckedById: value })}
                className="h-12"
              />
            </div>
            {employees.length === 0 && (
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                No active employees on the list yet - add them under Employees
                and they will appear here.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-[var(--border)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                What is going ({lines.length})
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLines([...lines, newLine()])}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add part
              </Button>
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => {
                const ready = readyByPart.get(line.partId) ?? 0;
                const asked = Math.floor(Number(line.quantity || 0));
                const tooMany = line.partId !== "" && asked > ready;
                const part = orderedParts.find((p) => p.partId === line.partId);

                return (
                  <div
                    key={line.key}
                    className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        Line {index + 1}
                      </span>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          title="Remove this line"
                          onClick={() =>
                            setLines(lines.filter((l) => l.key !== line.key))
                          }
                          className="cursor-pointer rounded p-1 text-[var(--error)] hover:bg-[var(--error-light)]"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      <Select
                        label="Part"
                        placeholder={
                          !form.companyId
                            ? "Choose the customer first"
                            : orderedParts.length === 0
                              ? "This customer has nothing on order"
                              : "Choose the part"
                        }
                        options={orderedParts.map((p) => ({
                          value: p.partId,
                          label: `${p.partCode} - ${p.name} (${nos(p.outstanding)} owed)`,
                        }))}
                        value={line.partId}
                        onChange={(value) =>
                          setLines(
                            lines.map((l) =>
                              l.key === line.key ? { ...l, partId: value } : l
                            )
                          )
                        }
                      />
                      <Input
                        label="Pieces going"
                        type="number"
                        placeholder="0"
                        value={line.quantity}
                        onChange={(e) =>
                          setLines(
                            lines.map((l) =>
                              l.key === line.key
                                ? { ...l, quantity: e.target.value }
                                : l
                            )
                          )
                        }
                      />
                    </div>
                    {line.partId && (
                      <p
                        className={cn(
                          "mt-2 text-sm",
                          tooMany
                            ? "font-medium text-[var(--error)]"
                            : "text-[var(--muted-foreground)]"
                        )}
                      >
                        {tooMany
                          ? `Only ${nos(ready)} piece${ready === 1 ? "" : "s"} of ${part?.partCode ?? "this part"} ${ready === 1 ? "is" : "are"} finished - you cannot send ${nos(asked)}.`
                          : `${nos(ready)} finished and on the shelf${asked > 0 ? ` · ${nos(ready - asked)} left after this` : ""}.`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-[var(--muted-foreground)]">
            The outward number is given automatically, in the same style as
            batch numbers - OUT-26J01 is the first note of October 2026.
          </p>
        </div>

        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => setIsFormOpen(false)}
          >
            Cancel
          </Button>
          <Button
            className="h-12"
            onClick={handleSave}
            isLoading={isSaving}
            disabled={
              !form.companyId ||
              !lines.some(
                (line) => line.partId && Math.floor(Number(line.quantity || 0)) > 0
              )
            }
          >
            <Truck className="mr-2 h-4 w-4" />
            Save Outward
          </Button>
        </ModalFooter>
      </Modal>

      {/* One note, read back */}
      <Modal
        isOpen={viewNote !== null}
        onClose={() => setViewNote(null)}
        title={viewNote ? `Outward ${viewNote.dispatchNumber}` : "Outward"}
        description={viewNote?.company.name}
        size="lg"
      >
        {viewNote && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-y-1">
              <dt className="text-[var(--muted-foreground)]">Date</dt>
              <dd>{formatDate(new Date(viewNote.dispatchDate))}</dd>
              <dt className="text-[var(--muted-foreground)]">Against PO</dt>
              <dd>{viewNote.customerOrder?.poNumber ?? "-"}</dd>
              <dt className="text-[var(--muted-foreground)]">Invoice</dt>
              <dd>{viewNote.invoiceNumber || "-"}</dd>
              <dt className="text-[var(--muted-foreground)]">Supervisor</dt>
              <dd>
                {viewNote.supervisor
                  ? `${viewNote.supervisor.name} (${viewNote.supervisor.employeeCode})`
                  : "-"}
              </dd>
              <dt className="text-[var(--muted-foreground)]">QC checked by</dt>
              <dd>
                {viewNote.qcCheckedBy
                  ? `${viewNote.qcCheckedBy.name} (${viewNote.qcCheckedBy.employeeCode})`
                  : "-"}
              </dd>
              <dt className="text-[var(--muted-foreground)]">Vehicle</dt>
              <dd>{viewNote.vehicleNumber || "-"}</dd>
              <dt className="text-[var(--muted-foreground)]">Driver</dt>
              <dd>{viewNote.driverName || "-"}</dd>
              <dt className="text-[var(--muted-foreground)]">Recorded by</dt>
              <dd>{viewNote.recordedBy ?? "-"}</dd>
            </dl>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part</TableHead>
                  <TableHead className="text-right">Pieces</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewNote.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {item.partCode}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      {nos(item.quantity)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatWeight(item.weight)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex justify-between rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-3">
              <span className="font-semibold">Total</span>
              <span className="font-semibold">
                {nos(viewNote.totalPieces)} pieces ·{" "}
                {formatWeight(viewNote.totalWeight)}
              </span>
            </div>

            {viewNote.notes && (
              <p className="text-[var(--muted-foreground)]">{viewNote.notes}</p>
            )}
          </div>
        )}
        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => setViewNote(null)}
          >
            Close
          </Button>
        </ModalFooter>
      </Modal>

      {/* Cancel a note */}
      <Modal
        isOpen={cancelNote !== null}
        onClose={() => setCancelNote(null)}
        title="Cancel Outward Note"
        size="sm"
      >
        <div className="pb-2">
          <p className="text-[var(--muted-foreground)]">
            Cancel{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {cancelNote?.dispatchNumber}
            </span>{" "}
            to {cancelNote?.company.name}?{" "}
            {cancelNote ? nos(cancelNote.totalPieces) : 0} piece
            {cancelNote?.totalPieces === 1 ? "" : "s"} go back into finished
            stock. Only do this if the castings never left.
          </p>
        </div>
        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => setCancelNote(null)}
          >
            Keep it
          </Button>
          <Button
            variant="destructive"
            className="h-12"
            onClick={handleCancel}
            isLoading={isSaving}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Cancel Note
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
