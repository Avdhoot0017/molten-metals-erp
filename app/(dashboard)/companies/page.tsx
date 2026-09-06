"use client";

import * as React from "react";
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

interface Company {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  isActive: boolean;
  createdAt: string;
}

export default function CompaniesPage() {
  const [companies, setCompanies] = React.useState<Company[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [selectedCompany, setSelectedCompany] = React.useState<Company | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isPageLoading, setIsPageLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const [formData, setFormData] = React.useState({
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
  });

  React.useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    setIsPageLoading(true);
    try {
      const response = await fetch("/api/companies");
      const data = await response.json();
      if (data.success) {
        setCompanies(data.data);
      }
    } catch (err) {
      console.error("Error fetching companies:", err);
    } finally {
      setIsPageLoading(false);
    }
  };

  const filteredCompanies = companies.filter(
    (company) =>
      company.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      company.contactPerson?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      company.city?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeCompanies = companies.filter((c) => c.isActive).length;

  const resetForm = () => {
    setFormData({
      name: "",
      contactPerson: "",
      phone: "",
      email: "",
      address: "",
      city: "",
      state: "",
      pincode: "",
    });
    setError("");
  };

  const handleAddCompany = async () => {
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
        setCompanies([data.data, ...companies]);
        setIsAddModalOpen(false);
        resetForm();
      } else {
        setError(data.error || "Failed to add company");
      }
    } catch (err) {
      setError("Failed to add company");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditCompany = async () => {
    if (!selectedCompany) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/companies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedCompany.id, ...formData }),
      });
      const data = await response.json();
      if (data.success) {
        setCompanies(companies.map((c) => (c.id === selectedCompany.id ? data.data : c)));
        setIsEditModalOpen(false);
        resetForm();
      } else {
        setError(data.error || "Failed to update company");
      }
    } catch (err) {
      setError("Failed to update company");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCompany = async () => {
    if (!selectedCompany) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/companies?id=${selectedCompany.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (data.success) {
        setCompanies(companies.filter((c) => c.id !== selectedCompany.id));
        setIsDeleteModalOpen(false);
        setSelectedCompany(null);
      }
    } catch (err) {
      console.error("Error deleting company:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const openEditModal = (company: Company) => {
    setSelectedCompany(company);
    setFormData({
      name: company.name,
      contactPerson: company.contactPerson || "",
      phone: company.phone || "",
      email: company.email || "",
      address: company.address || "",
      city: company.city || "",
      state: company.state || "",
      pincode: company.pincode || "",
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
            Companies / Clients
          </h1>
          <p className="text-[var(--muted-foreground)]">
            Manage your client companies and their information
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchCompanies}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Company
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
                  Total Companies
                </p>
                <p className="text-3xl font-bold mt-1">{companies.length}</p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--accent)]">
                <Building2 className="h-6 w-6 text-[var(--primary)]" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Active Clients
                </p>
                <p className="text-3xl font-bold mt-1">{activeCompanies}</p>
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
                  Inactive Clients
                </p>
                <p className="text-3xl font-bold mt-1">
                  {companies.length - activeCompanies}
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
              placeholder="Search companies by name, contact, or city..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Companies Grid */}
      {filteredCompanies.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              icon={Building2}
              title="No companies found"
              description="Add your first client company to start tracking dispatches."
              action={
                <Button onClick={() => setIsAddModalOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Company
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCompanies.map((company) => (
            <Card
              key={company.id}
              className="hover:shadow-md transition-shadow"
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--accent)]">
                      <Building2 className="h-5 w-5 text-[var(--primary)]" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[var(--foreground)]">
                        {company.name}
                      </h3>
                      <Badge
                        variant={company.isActive ? "success" : "secondary"}
                        className="mt-1"
                      >
                        {company.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditModal(company)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedCompany(company);
                        setIsDeleteModalOpen(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-[var(--error)]" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  {company.contactPerson && (
                    <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
                      <span className="font-medium text-[var(--foreground)]">
                        {company.contactPerson}
                      </span>
                    </div>
                  )}
                  {company.phone && (
                    <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
                      <Phone className="h-4 w-4" />
                      <span>{company.phone}</span>
                    </div>
                  )}
                  {company.email && (
                    <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
                      <Mail className="h-4 w-4" />
                      <span>{company.email}</span>
                    </div>
                  )}
                  {(company.city || company.state) && (
                    <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
                      <MapPin className="h-4 w-4" />
                      <span>
                        {[company.city, company.state]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-[var(--border)]">
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Added on {formatDate(new Date(company.createdAt))}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Company Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          resetForm();
        }}
        title="Add New Company"
        description="Add a new client company to the system"
        size="lg"
      >
        <div className="space-y-4 pb-2">
          {error && (
            <div className="p-4 rounded-lg bg-[var(--error-light)] border border-[var(--error)] text-[var(--error)] text-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Input
                label="Company Name"
                placeholder="Enter company name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="h-12"
              />
            </div>
            <Input
              label="Contact Person"
              placeholder="Enter contact person name"
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
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
              className="h-12"
            />
            <Input
              label="Email"
              type="email"
              placeholder="email@company.com"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              className="h-12"
            />
            <Input
              label="Pincode"
              placeholder="Enter pincode"
              value={formData.pincode}
              onChange={(e) =>
                setFormData({ ...formData, pincode: e.target.value })
              }
              className="h-12"
            />
            <Input
              label="City"
              placeholder="Enter city"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              className="h-12"
            />
            <Input
              label="State"
              placeholder="Enter state"
              value={formData.state}
              onChange={(e) =>
                setFormData({ ...formData, state: e.target.value })
              }
              className="h-12"
            />
            <div className="col-span-2">
              <Textarea
                label="Address"
                placeholder="Enter full address"
                value={formData.address}
                onChange={(e) =>
                  setFormData({ ...formData, address: e.target.value })
                }
                className="min-h-[80px]"
              />
            </div>
          </div>
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
          <Button className="h-12" onClick={handleAddCompany} isLoading={isLoading}>
            <Plus className="h-4 w-4 mr-2" />
            Add Company
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit Company Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          resetForm();
        }}
        title="Edit Company"
        description="Update company information"
        size="lg"
      >
        <div className="space-y-4 pb-2">
          {error && (
            <div className="p-4 rounded-lg bg-[var(--error-light)] border border-[var(--error)] text-[var(--error)] text-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Input
                label="Company Name"
                placeholder="Enter company name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="h-12"
              />
            </div>
            <Input
              label="Contact Person"
              placeholder="Enter contact person name"
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
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
              className="h-12"
            />
            <Input
              label="Email"
              type="email"
              placeholder="email@company.com"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              className="h-12"
            />
            <Input
              label="Pincode"
              placeholder="Enter pincode"
              value={formData.pincode}
              onChange={(e) =>
                setFormData({ ...formData, pincode: e.target.value })
              }
              className="h-12"
            />
            <Input
              label="City"
              placeholder="Enter city"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              className="h-12"
            />
            <Input
              label="State"
              placeholder="Enter state"
              value={formData.state}
              onChange={(e) =>
                setFormData({ ...formData, state: e.target.value })
              }
              className="h-12"
            />
            <div className="col-span-2">
              <Textarea
                label="Address"
                placeholder="Enter full address"
                value={formData.address}
                onChange={(e) =>
                  setFormData({ ...formData, address: e.target.value })
                }
                className="min-h-[80px]"
              />
            </div>
          </div>
        </div>
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
          <Button className="h-12" onClick={handleEditCompany} isLoading={isLoading}>
            Save Changes
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setSelectedCompany(null);
        }}
        title="Delete Company"
        size="sm"
      >
        <div className="pb-2">
          <p className="text-[var(--muted-foreground)]">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {selectedCompany?.name}
            </span>
            ? This action cannot be undone.
          </p>
        </div>
        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => {
              setIsDeleteModalOpen(false);
              setSelectedCompany(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="h-12"
            onClick={handleDeleteCompany}
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
