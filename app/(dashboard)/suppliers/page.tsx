"use client";

import * as React from "react";
import {
  Users,
  Plus,
  Search,
  Edit,
  Trash2,
  Phone,
  Mail,
  MapPin,
  RefreshCw,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSpinner } from "@/components/ui/loading";
import { formatDate } from "@/lib/utils";

interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  gstNumber?: string;
  isActive: boolean;
  createdAt: string;
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [selectedSupplier, setSelectedSupplier] = React.useState<Supplier | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isPageLoading, setIsPageLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const [formData, setFormData] = React.useState({
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    gstNumber: "",
  });

  React.useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async () => {
    setIsPageLoading(true);
    try {
      const response = await fetch("/api/suppliers");
      const data = await response.json();
      if (data.success) {
        setSuppliers(data.data);
      }
    } catch (err) {
      console.error("Error fetching suppliers:", err);
    } finally {
      setIsPageLoading(false);
    }
  };

  const filteredSuppliers = suppliers.filter(
    (supplier) =>
      supplier.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      supplier.contactPerson?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      supplier.gstNumber?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeSuppliers = suppliers.filter((s) => s.isActive).length;

  const resetForm = () => {
    setFormData({
      name: "",
      contactPerson: "",
      phone: "",
      email: "",
      address: "",
      gstNumber: "",
    });
    setError("");
  };

  const handleAddSupplier = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (data.success) {
        setSuppliers([data.data, ...suppliers]);
        setIsAddModalOpen(false);
        resetForm();
      } else {
        setError(data.error || "Failed to add supplier");
      }
    } catch (err) {
      setError("Failed to add supplier");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditSupplier = async () => {
    if (!selectedSupplier) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/suppliers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedSupplier.id, ...formData }),
      });
      const data = await response.json();
      if (data.success) {
        setSuppliers(suppliers.map((s) => (s.id === selectedSupplier.id ? data.data : s)));
        setIsEditModalOpen(false);
        resetForm();
      } else {
        setError(data.error || "Failed to update supplier");
      }
    } catch (err) {
      setError("Failed to update supplier");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSupplier = async () => {
    if (!selectedSupplier) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/suppliers?id=${selectedSupplier.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (data.success) {
        setSuppliers(suppliers.filter((s) => s.id !== selectedSupplier.id));
        setIsDeleteModalOpen(false);
        setSelectedSupplier(null);
      }
    } catch (err) {
      console.error("Error deleting supplier:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const openEditModal = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setFormData({
      name: supplier.name,
      contactPerson: supplier.contactPerson || "",
      phone: supplier.phone || "",
      email: supplier.email || "",
      address: supplier.address || "",
      gstNumber: supplier.gstNumber || "",
    });
    setIsEditModalOpen(true);
  };

  if (isPageLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Suppliers Management
          </h1>
          <p className="text-[var(--muted-foreground)]">
            Manage your aluminum ingot suppliers
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchSuppliers}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Supplier
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Total Suppliers
                </p>
                <p className="text-3xl font-bold mt-1">{suppliers.length}</p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--accent)]">
                <Users className="h-6 w-6 text-[var(--primary)]" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Active Suppliers
                </p>
                <p className="text-3xl font-bold mt-1">{activeSuppliers}</p>
              </div>
              <Badge variant="success" className="text-base px-3 py-1">
                Active
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Inactive Suppliers
                </p>
                <p className="text-3xl font-bold mt-1">
                  {suppliers.length - activeSuppliers}
                </p>
              </div>
              <Badge variant="secondary" className="text-base px-3 py-1">
                Inactive
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
            <Input
              placeholder="Search suppliers by name, contact, or GST..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Suppliers Table */}
      <Card>
        <CardHeader>
          <CardTitle>Suppliers List</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredSuppliers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No suppliers found"
              description="Add your first supplier to start creating purchase orders."
              action={
                <Button onClick={() => setIsAddModalOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Supplier
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Supplier
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Contact
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      GST Number
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Status
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Added On
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((supplier) => (
                    <tr
                      key={supplier.id}
                      className="border-b border-[var(--border)] hover:bg-[var(--muted)]"
                    >
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-medium">{supplier.name}</p>
                          {supplier.address && (
                            <p className="text-sm text-[var(--muted-foreground)] flex items-center gap-1 mt-1">
                              <MapPin className="h-3 w-3" />
                              {supplier.address}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          {supplier.contactPerson && (
                            <p className="text-sm font-medium">
                              {supplier.contactPerson}
                            </p>
                          )}
                          {supplier.phone && (
                            <p className="text-sm text-[var(--muted-foreground)] flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {supplier.phone}
                            </p>
                          )}
                          {supplier.email && (
                            <p className="text-sm text-[var(--muted-foreground)] flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {supplier.email}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {supplier.gstNumber ? (
                          <span className="font-mono text-sm bg-[var(--muted)] px-2 py-1 rounded">
                            {supplier.gstNumber}
                          </span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">
                            -
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={supplier.isActive ? "success" : "secondary"}
                        >
                          {supplier.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-[var(--muted-foreground)]">
                        {formatDate(new Date(supplier.createdAt))}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditModal(supplier)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedSupplier(supplier);
                              setIsDeleteModalOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-[var(--error)]" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Supplier Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          resetForm();
        }}
        title="Add New Supplier"
        description="Add a new aluminum supplier"
        size="lg"
      >
        <div className="space-y-4">
          {error && (
            <div className="p-4 rounded-lg bg-[var(--error-light)] border border-[var(--error)] text-[var(--error)] text-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Input
                label="Supplier Name"
                placeholder="Enter supplier name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />
            </div>
            <Input
              label="Contact Person"
              placeholder="Enter contact person name"
              value={formData.contactPerson}
              onChange={(e) =>
                setFormData({ ...formData, contactPerson: e.target.value })
              }
            />
            <Input
              label="Phone"
              placeholder="+91 XXXXX XXXXX"
              value={formData.phone}
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
            />
            <Input
              label="Email"
              type="email"
              placeholder="email@supplier.com"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
            />
            <Input
              label="GST Number"
              placeholder="Enter GST number"
              value={formData.gstNumber}
              onChange={(e) =>
                setFormData({ ...formData, gstNumber: e.target.value })
              }
            />
            <div className="col-span-2">
              <Textarea
                label="Address"
                placeholder="Enter full address"
                value={formData.address}
                onChange={(e) =>
                  setFormData({ ...formData, address: e.target.value })
                }
              />
            </div>
          </div>
        </div>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setIsAddModalOpen(false);
              resetForm();
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleAddSupplier} isLoading={isLoading}>
            <Plus className="h-4 w-4 mr-2" />
            Add Supplier
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit Supplier Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          resetForm();
        }}
        title="Edit Supplier"
        description="Update supplier information"
        size="lg"
      >
        <div className="space-y-4">
          {error && (
            <div className="p-4 rounded-lg bg-[var(--error-light)] border border-[var(--error)] text-[var(--error)] text-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Input
                label="Supplier Name"
                placeholder="Enter supplier name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />
            </div>
            <Input
              label="Contact Person"
              placeholder="Enter contact person name"
              value={formData.contactPerson}
              onChange={(e) =>
                setFormData({ ...formData, contactPerson: e.target.value })
              }
            />
            <Input
              label="Phone"
              placeholder="+91 XXXXX XXXXX"
              value={formData.phone}
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
            />
            <Input
              label="Email"
              type="email"
              placeholder="email@supplier.com"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
            />
            <Input
              label="GST Number"
              placeholder="Enter GST number"
              value={formData.gstNumber}
              onChange={(e) =>
                setFormData({ ...formData, gstNumber: e.target.value })
              }
            />
            <div className="col-span-2">
              <Textarea
                label="Address"
                placeholder="Enter full address"
                value={formData.address}
                onChange={(e) =>
                  setFormData({ ...formData, address: e.target.value })
                }
              />
            </div>
          </div>
        </div>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setIsEditModalOpen(false);
              resetForm();
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleEditSupplier} isLoading={isLoading}>
            Save Changes
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setSelectedSupplier(null);
        }}
        title="Delete Supplier"
        size="sm"
      >
        <p className="text-[var(--muted-foreground)]">
          Are you sure you want to delete{" "}
          <span className="font-semibold text-[var(--foreground)]">
            {selectedSupplier?.name}
          </span>
          ? This action cannot be undone.
        </p>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setIsDeleteModalOpen(false);
              setSelectedSupplier(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDeleteSupplier}
            isLoading={isLoading}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
