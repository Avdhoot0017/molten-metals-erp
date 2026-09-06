"use client";

import * as React from "react";
import {
  Boxes,
  Plus,
  Search,
  Edit,
  Trash2,
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
import { formatWeight, formatDate } from "@/lib/utils";
import { Pagination, type PaginationMeta } from "@/components/ui/pagination";
import { parseWeightInput, weightToInput, WEIGHT_UNIT } from "@/lib/units";

interface Part {
  id: string;
  partCode: string;
  name: string;
  description?: string;
  weightPerPiece: number;
  expectedScrap: number;
  isActive: boolean;
  createdAt: string;
}

export default function PartsPage() {
  const [parts, setParts] = React.useState<Part[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [pagination, setPagination] = React.useState<PaginationMeta | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [selectedPart, setSelectedPart] = React.useState<Part | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isPageLoading, setIsPageLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const [formData, setFormData] = React.useState({
    partCode: "",
    name: "",
    description: "",
    weightPerPiece: "",
    expectedScrap: "",
  });

  // Debounce typing so we do not hit the API on every keystroke
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1); // a new search always starts from the first page
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchParts = React.useCallback(async () => {
    setIsPageLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);

      const response = await fetch(`/api/parts?${params.toString()}`);
      const data = await response.json();
      if (data.success) {
        setParts(data.data);
        setPagination(data.pagination ?? null);
      }
    } catch (err) {
      console.error("Error fetching parts:", err);
    } finally {
      setIsPageLoading(false);
    }
  }, [page, pageSize, debouncedSearch]);

  React.useEffect(() => {
    void (async () => {
      await fetchParts();
    })();
  }, [fetchParts]);

  // Rows come back already filtered and paged by the API
  const filteredParts = parts;
  const activeParts = pagination?.total ?? parts.length;

  const resetForm = () => {
    setFormData({
      partCode: "",
      name: "",
      description: "",
      weightPerPiece: "",
      expectedScrap: "",
    });
    setError("");
  };

  const handleAddPart = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/parts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          weightPerPiece: parseWeightInput(formData.weightPerPiece),
        }),
      });
      const data = await response.json();
      if (data.success) {
        setParts([data.data, ...parts]);
        setIsAddModalOpen(false);
        resetForm();
      } else {
        setError(data.error || "Failed to add part");
      }
    } catch (err) {
      setError("Failed to add part");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditPart = async () => {
    if (!selectedPart) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/parts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedPart.id,
          ...formData,
          weightPerPiece: parseWeightInput(formData.weightPerPiece),
        }),
      });
      const data = await response.json();
      if (data.success) {
        setParts(parts.map((p) => (p.id === selectedPart.id ? data.data : p)));
        setIsEditModalOpen(false);
        resetForm();
      } else {
        setError(data.error || "Failed to update part");
      }
    } catch (err) {
      setError("Failed to update part");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeletePart = async () => {
    if (!selectedPart) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/parts?id=${selectedPart.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (data.success) {
        setParts(parts.filter((p) => p.id !== selectedPart.id));
        setIsDeleteModalOpen(false);
        setSelectedPart(null);
      }
    } catch (err) {
      console.error("Error deleting part:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const openEditModal = (part: Part) => {
    setSelectedPart(part);
    setFormData({
      partCode: part.partCode,
      name: part.name,
      description: part.description || "",
      weightPerPiece: weightToInput(part.weightPerPiece),
      expectedScrap: part.expectedScrap.toString(),
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
            Parts Management
          </h1>
          <p className="text-[var(--muted-foreground)]">
            Manage manufacturing parts and their specifications
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchParts}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Part
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Total Parts
                </p>
                <p className="text-3xl font-bold mt-1">{parts.length}</p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--accent)]">
                <Boxes className="h-6 w-6 text-[var(--primary)]" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Active Parts
                </p>
                <p className="text-3xl font-bold mt-1">{activeParts}</p>
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
                  Inactive Parts
                </p>
                <p className="text-3xl font-bold mt-1">
                  {parts.length - activeParts}
                </p>
              </div>
              <Badge variant="secondary" className="text-base px-3 py-1">
                Inactive
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Search parts by name or code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Parts List */}
      <Card>
        <CardHeader>
          <CardTitle>Parts Catalog</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredParts.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No parts found"
              description="Add your first part to get started with production tracking."
              action={
                <Button onClick={() => setIsAddModalOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Part
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Part Code
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Name
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Weight/Piece
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Expected Scrap
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Status
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Created
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredParts.map((part) => (
                    <tr
                      key={part.id}
                      className="border-b border-[var(--border)] hover:bg-[var(--muted)]"
                    >
                      <td className="py-3 px-4">
                        <span className="font-mono text-sm bg-[var(--muted)] px-2 py-1 rounded">
                          {part.partCode}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-medium">{part.name}</p>
                          {part.description && (
                            <p className="text-sm text-[var(--muted-foreground)] truncate max-w-xs">
                              {part.description}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {formatWeight(part.weightPerPiece)}
                      </td>
                      <td className="py-3 px-4">{part.expectedScrap}%</td>
                      <td className="py-3 px-4">
                        <Badge variant={part.isActive ? "success" : "secondary"}>
                          {part.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-[var(--muted-foreground)]">
                        {formatDate(new Date(part.createdAt))}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditModal(part)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedPart(part);
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

          {pagination && (
            <Pagination
              className="mt-4"
              meta={pagination}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Add Part Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          resetForm();
        }}
        title="Add New Part"
        description="Create a new part for manufacturing"
        size="lg"
      >
        <div className="space-y-4 pb-2">
          {error && (
            <div className="p-4 rounded-lg bg-[var(--error-light)] border border-[var(--error)] text-[var(--error)] text-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Part Code"
              placeholder="e.g., ENG-BLK-001"
              value={formData.partCode}
              onChange={(e) =>
                setFormData({ ...formData, partCode: e.target.value })
              }
              className="h-12"
            />
            <Input
              label="Part Name"
              placeholder="Enter part name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="h-12"
            />
            <Input
              label={`Weight per Piece (${WEIGHT_UNIT})`}
              type="number"
              placeholder="Enter weight in kg"
              value={formData.weightPerPiece}
              onChange={(e) =>
                setFormData({ ...formData, weightPerPiece: e.target.value })
              }
              className="h-12"
            />
            <Input
              label="Expected Scrap (%)"
              type="number"
              placeholder="Enter expected scrap percentage"
              value={formData.expectedScrap}
              onChange={(e) =>
                setFormData({ ...formData, expectedScrap: e.target.value })
              }
              className="h-12"
            />
            <div className="col-span-2">
              <Textarea
                label="Description (Optional)"
                placeholder="Add a description for this part..."
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
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
          <Button className="h-12" onClick={handleAddPart} isLoading={isLoading}>
            <Plus className="h-4 w-4 mr-2" />
            Add Part
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit Part Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          resetForm();
        }}
        title="Edit Part"
        description="Update part information"
        size="lg"
      >
        <div className="space-y-4 pb-2">
          {error && (
            <div className="p-4 rounded-lg bg-[var(--error-light)] border border-[var(--error)] text-[var(--error)] text-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Part Code"
              placeholder="e.g., ENG-BLK-001"
              value={formData.partCode}
              onChange={(e) =>
                setFormData({ ...formData, partCode: e.target.value })
              }
              disabled
              className="h-12"
            />
            <Input
              label="Part Name"
              placeholder="Enter part name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="h-12"
            />
            <Input
              label={`Weight per Piece (${WEIGHT_UNIT})`}
              type="number"
              placeholder="Enter weight in kg"
              value={formData.weightPerPiece}
              onChange={(e) =>
                setFormData({ ...formData, weightPerPiece: e.target.value })
              }
              className="h-12"
            />
            <Input
              label="Expected Scrap (%)"
              type="number"
              placeholder="Enter expected scrap percentage"
              value={formData.expectedScrap}
              onChange={(e) =>
                setFormData({ ...formData, expectedScrap: e.target.value })
              }
              className="h-12"
            />
            <div className="col-span-2">
              <Textarea
                label="Description (Optional)"
                placeholder="Add a description for this part..."
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
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
          <Button className="h-12" onClick={handleEditPart} isLoading={isLoading}>
            Save Changes
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setSelectedPart(null);
        }}
        title="Delete Part"
        size="sm"
      >
        <p className="text-[var(--muted-foreground)] pb-2">
          Are you sure you want to delete{" "}
          <span className="font-semibold text-[var(--foreground)]">
            {selectedPart?.name}
          </span>
          ? This action cannot be undone.
        </p>
        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => {
              setIsDeleteModalOpen(false);
              setSelectedPart(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="h-12"
            onClick={handleDeletePart}
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
