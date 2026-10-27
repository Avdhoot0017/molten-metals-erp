"use client";

import * as React from "react";
import Link from "next/link";
import {
  Building2,
  Plus,
  Search,
  Edit,
  Trash2,
  Phone,
  Mail,
  MapPin,
  RefreshCw,
  FileText,
  Receipt,
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
import { formatDate } from "@/lib/utils";
import { canWrite } from "@/lib/permissions";
import type { UserRole } from "@/types";

/**
 * The customers we cast for.
 *
 * Stored in the "companies" table, which is what this has always been - the
 * screens use the word the office uses. Their purchase orders live on the
 * Customer POs page and point back here.
 */
interface Customer {
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
  isActive: boolean;
  createdAt: string;
}

const EMPTY_FORM = {
  name: "",
  contactPerson: "",
  phone: "",
  email: "",
  gstNumber: "",
  stateCode: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
};

/**
 * The first two digits of a GSTIN are the state code, always.
 *
 * Typing it twice is two chances to get it wrong, so it is filled in from the
 * GSTIN and can still be overwritten - an old record may carry a code that
 * does not match the number on file, and quietly correcting it would hide
 * that.
 */
function stateCodeFromGstin(gstin: string): string {
  const digits = gstin.trim().slice(0, 2);
  return /^\d{2}$/.test(digits) ? digits : "";
}

export default function CustomersPage() {
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [orderCounts, setOrderCounts] = React.useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterGst, setFilterGst] = React.useState("");
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Customer | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isPageLoading, setIsPageLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [formData, setFormData] = React.useState(EMPTY_FORM);

  /*
   * Who may change a customer, read from the permission matrix rather than
   * from a role name - the read-only Accounts role can see this page, and
   * buttons it cannot use are worse than no buttons.
   */
  const [role, setRole] = React.useState<UserRole | null>(null);
  const canManage = role ? canWrite({ role }, "companies") : false;

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        if (data.success) setRole(data.user.role);
      } catch {
        // A failed session read leaves the page read-only, which is the safe
        // way round
      }
    })();
  }, []);

  const fetchCustomers = React.useCallback(async () => {
    setIsPageLoading(true);
    try {
      const [customerRes, orderRes] = await Promise.all([
        fetch("/api/companies"),
        fetch("/api/customer-orders"),
      ]);
      const customerData = await customerRes.json();
      if (customerData.success) setCustomers(customerData.data);

      // How many orders each customer has on file. Not every role may read
      // the orders, so a refusal here simply leaves the column blank.
      if (orderRes.ok) {
        const orderData = await orderRes.json();
        if (orderData.success) {
          const counts: Record<string, number> = {};
          for (const order of orderData.data as Array<{ companyId: string }>) {
            counts[order.companyId] = (counts[order.companyId] ?? 0) + 1;
          }
          setOrderCounts(counts);
        }
      }
    } catch (err) {
      console.error("Error fetching customers:", err);
    } finally {
      setIsPageLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const filtered = customers.filter((customer) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !query ||
      customer.name.toLowerCase().includes(query) ||
      customer.contactPerson?.toLowerCase().includes(query) ||
      customer.city?.toLowerCase().includes(query) ||
      customer.gstNumber?.toLowerCase().includes(query);

    const matchesGst =
      filterGst === ""
        ? true
        : filterGst === "with"
          ? Boolean(customer.gstNumber)
          : !customer.gstNumber;

    return matchesQuery && matchesGst;
  });

  const withGst = customers.filter((c) => c.gstNumber).length;
  const withOrders = customers.filter((c) => (orderCounts[c.id] ?? 0) > 0).length;

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setError("");
  };

  const handleAdd = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (data.success) {
        setCustomers([data.data, ...customers]);
        setIsAddModalOpen(false);
        resetForm();
      } else {
        setError(data.error || "Could not save this customer");
      }
    } catch {
      setError("Could not save this customer");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!selected) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/companies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, ...formData }),
      });
      const data = await response.json();
      if (data.success) {
        setCustomers(customers.map((c) => (c.id === selected.id ? data.data : c)));
        setIsEditModalOpen(false);
        resetForm();
      } else {
        setError(data.error || "Could not save the changes");
      }
    } catch {
      setError("Could not save the changes");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/companies?id=${selected.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (data.success) {
        setCustomers(customers.filter((c) => c.id !== selected.id));
        setIsDeleteModalOpen(false);
        setSelected(null);
      }
    } catch (err) {
      console.error("Error removing customer:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const openEditModal = (customer: Customer) => {
    setSelected(customer);
    setFormData({
      name: customer.name,
      contactPerson: customer.contactPerson || "",
      phone: customer.phone || "",
      email: customer.email || "",
      gstNumber: customer.gstNumber || "",
      stateCode: customer.stateCode || "",
      address: customer.address || "",
      city: customer.city || "",
      state: customer.state || "",
      pincode: customer.pincode || "",
    });
    setIsEditModalOpen(true);
  };

  /* The same fields on both modals - one form, filled in or blank. */
  const customerForm = (
    <div className="space-y-4 pb-2">
      {error && (
        <div className="rounded-lg border border-[var(--error)] bg-[var(--error-light)] p-4 text-sm text-[var(--error)]">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Input
            label="Customer name"
            placeholder="e.g. Creative Tools & Components (I) Pvt Ltd"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="h-12"
          />
        </div>
        <Input
          label="GSTIN"
          placeholder="27AACCC2328N1ZK"
          value={formData.gstNumber}
          onChange={(e) => {
            const gstNumber = e.target.value.toUpperCase();
            setFormData({
              ...formData,
              gstNumber,
              // Filled in from the number, unless it has been typed over
              stateCode: formData.stateCode || stateCodeFromGstin(gstNumber),
            });
          }}
          className="h-12"
          helperText="As printed on their purchase orders"
        />
        <Input
          label="State code"
          placeholder="27"
          value={formData.stateCode}
          onChange={(e) =>
            setFormData({ ...formData, stateCode: e.target.value })
          }
          className="h-12"
          helperText="The first two digits of the GSTIN"
        />
        <Input
          label="Contact person"
          placeholder="e.g. Mr. Shashikant Tatkare"
          value={formData.contactPerson}
          onChange={(e) =>
            setFormData({ ...formData, contactPerson: e.target.value })
          }
          className="h-12"
        />
        <Input
          label="Phone"
          placeholder="+91 XXXXX XXXXX"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          className="h-12"
        />
        <Input
          label="Email"
          type="email"
          placeholder="purchase@company.com"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className="h-12"
        />
        <Input
          label="Pincode"
          placeholder="412115"
          value={formData.pincode}
          onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
          className="h-12"
        />
        <Input
          label="City"
          placeholder="Pune"
          value={formData.city}
          onChange={(e) => setFormData({ ...formData, city: e.target.value })}
          className="h-12"
        />
        <Input
          label="State"
          placeholder="Maharashtra"
          value={formData.state}
          onChange={(e) => setFormData({ ...formData, state: e.target.value })}
          className="h-12"
        />
        <div className="col-span-2">
          <Textarea
            label="Address"
            placeholder="Full billing address"
            value={formData.address}
            onChange={(e) =>
              setFormData({ ...formData, address: e.target.value })
            }
            className="min-h-[80px]"
          />
        </div>
      </div>
    </div>
  );

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
            Customers
          </h1>
          <p className="text-[var(--muted-foreground)]">
            The companies we cast for, and the details their orders are raised
            against
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchCustomers}>
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
            <Button onClick={() => setIsAddModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Customer
            </Button>
          )}
        </div>
      </div>

      {/* Counted across every customer on file, not the page on screen */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          {
            label: "Customers",
            value: customers.length.toLocaleString("en-IN"),
            hint: "on file",
            icon: Building2,
          },
          {
            label: "With GSTIN",
            value: withGst.toLocaleString("en-IN"),
            hint:
              customers.length - withGst > 0
                ? `${customers.length - withGst} still to be filled in`
                : "all of them",
            icon: Receipt,
          },
          {
            label: "Have sent orders",
            value: withOrders.toLocaleString("en-IN"),
            hint: "customers with a PO on file",
            icon: FileText,
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

      {/* Search and filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="relative sm:col-span-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Search by name, contact, city or GSTIN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              options={[
                { value: "", label: "All customers" },
                { value: "with", label: "GSTIN on file" },
                { value: "without", label: "GSTIN missing" },
              ]}
              value={filterGst}
              onChange={setFilterGst}
            />
          </div>
          {(searchQuery || filterGst) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setFilterGst("");
              }}
              className="mt-3 cursor-pointer text-sm text-[var(--primary)] hover:underline"
            >
              Clear filters
            </button>
          )}
        </CardContent>
      </Card>

      {/* Customer list */}
      <Card>
        <CardHeader>
          <CardTitle>Customer List</CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No customers found"
              description={
                canManage
                  ? "Add a customer, then record the purchase orders they send."
                  : "No customers have been added yet."
              }
              action={
                canManage ? (
                  <Button onClick={() => setIsAddModalOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Customer
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="shrink-0 rounded-lg bg-[var(--accent)] p-2">
                          <Building2 className="h-4 w-4 text-[var(--primary)]" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-[var(--foreground)]">
                            {customer.name}
                          </p>
                          {customer.contactPerson && (
                            <p className="truncate text-xs text-[var(--muted-foreground)]">
                              {customer.contactPerson}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1 text-sm">
                        {customer.phone && (
                          <div className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                            <Phone className="h-3.5 w-3.5" />
                            <span>{customer.phone}</span>
                          </div>
                        )}
                        {customer.email && (
                          <div className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                            <Mail className="h-3.5 w-3.5" />
                            <span className="truncate">{customer.email}</span>
                          </div>
                        )}
                        {!customer.phone && !customer.email && (
                          <span className="text-[var(--muted-foreground)]">-</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {customer.gstNumber ? (
                        <div>
                          <p className="font-mono text-xs">{customer.gstNumber}</p>
                          {customer.stateCode && (
                            <p className="text-xs text-[var(--muted-foreground)]">
                              State code {customer.stateCode}
                            </p>
                          )}
                        </div>
                      ) : (
                        <Badge variant="secondary">Not on file</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {customer.city || customer.state ? (
                        <div className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
                          <MapPin className="h-3.5 w-3.5" />
                          <span>
                            {[customer.city, customer.state]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[var(--muted-foreground)]">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {orderCounts[customer.id] ? (
                        <Link
                          href={`/customer-orders?customer=${customer.id}`}
                          className="font-medium text-[var(--primary)] hover:underline"
                        >
                          {orderCounts[customer.id]}
                        </Link>
                      ) : (
                        <span className="text-[var(--muted-foreground)]">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-[var(--muted-foreground)]">
                      {formatDate(new Date(customer.createdAt))}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {canManage ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Edit customer"
                              onClick={() => openEditModal(customer)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Remove customer"
                              onClick={() => {
                                setSelected(customer);
                                setIsDeleteModalOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-[var(--error)]" />
                            </Button>
                          </>
                        ) : (
                          <span className="text-sm text-[var(--muted-foreground)]">
                            View only
                          </span>
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

      {/* Add */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          resetForm();
        }}
        title="Add Customer"
        description="Their details are used on every order raised against them"
        size="lg"
      >
        {customerForm}
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
          <Button
            className="h-12"
            onClick={handleAdd}
            isLoading={isLoading}
            disabled={!formData.name.trim()}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Customer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          resetForm();
        }}
        title="Edit Customer"
        description="Changes here do not alter orders already recorded"
        size="lg"
      >
        {customerForm}
        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => {
              setIsEditModalOpen(false);
              resetForm();
            }}
          >
            Cancel
          </Button>
          <Button
            className="h-12"
            onClick={handleEdit}
            isLoading={isLoading}
            disabled={!formData.name.trim()}
          >
            Save Changes
          </Button>
        </ModalFooter>
      </Modal>

      {/* Remove */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setSelected(null);
        }}
        title="Remove Customer"
        size="sm"
      >
        <div className="pb-2">
          <p className="text-[var(--muted-foreground)]">
            Remove{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {selected?.name}
            </span>{" "}
            from the customer list? Their orders stay on file and can still be
            read.
          </p>
        </div>
        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => {
              setIsDeleteModalOpen(false);
              setSelected(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="h-12"
            onClick={handleDelete}
            isLoading={isLoading}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Remove
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
