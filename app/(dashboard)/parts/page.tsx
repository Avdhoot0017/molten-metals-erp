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
import { expectedScrapOf } from "@/lib/parts";
import { canWrite } from "@/lib/permissions";
import { ALLOY_GRADES, gradeSpec } from "@/lib/ingot";
import type { UserRole } from "@/types";

interface Part {
  id: string;
  partCode: string;
  name: string;
  description?: string;
  /** The finished casting, in grams. */
  weightPerPiece: number;
  /**
   * Metal poured for one casting, in grams - the part plus its gating. Null on
   * parts recorded before it was tracked.
   */
  pouringWeight: number | null;
  /** The alloy it is cast in - decides which scrap line a reject is booked to. */
  alloyGrade: string;
  isActive: boolean;
  createdAt: string;
}

/**
 * Expected scrap per casting, shown rather than asked for.
 *
 * It is the gating - runners, risers, feeders - poured with the part and cut
 * off again, so it is fully determined by the two weights above it. It used to
 * be typed in as a percentage, which meant it could contradict them; deriving
 * it here, and again on the server before saving, means it cannot.
 */
function ExpectedScrapReadout({
  weightPerPiece,
  pouringWeight,
}: {
  weightPerPiece: string;
  pouringWeight: string;
}) {
  const finished = parseWeightInput(weightPerPiece);
  const poured = parseWeightInput(pouringWeight);
  const ready = finished > 0 && poured > 0;
  // Pouring less than the casting weighs is a typo, not a thin gating system.
  const impossible = ready && poured < finished;
  const scrap = ready && !impossible ? poured - finished : 0;

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
        Expected Scrap ({WEIGHT_UNIT})
      </span>
      <div
        className={`flex h-12 items-center rounded-lg border px-3 ${
          impossible
            ? "border-[var(--destructive)] bg-[var(--destructive)]/5"
            : "border-[var(--border)] bg-[var(--muted)]"
        }`}
      >
        {impossible ? (
          <span className="text-sm text-[var(--destructive)]">
            Pouring weight is below the part weight
          </span>
        ) : ready ? (
          <span className="font-medium">{formatWeight(scrap)}</span>
        ) : (
          <span className="text-sm text-[var(--muted-foreground)]">
            Enter both weights
          </span>
        )}
      </div>
      <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
        {ready && !impossible
          ? `Gating cut off each casting - ${((scrap / poured) * 100).toFixed(1)}% of the metal poured.`
          : "Worked out from the pouring weight minus the part weight."}
      </p>
    </div>
  );
}

export default function PartsPage() {
  const [parts, setParts] = React.useState<Part[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [pagination, setPagination] = React.useState<PaginationMeta | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  /**
   * Who may change parts, read from the permission matrix rather than a role
   * list here. The page previously offered Add, Edit and Delete to everyone,
   * including the read-only Accounts role, so the buttons were there but the
   * API answered 403 - a control that cannot work is worse than no control.
   */
  const [role, setRole] = React.useState<UserRole | null>(null);
  const canManage = role ? canWrite({ role }, "parts") : false;
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
    pouringWeight: "",
    alloyGrade: "LM6",
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
      pouringWeight: "",
      alloyGrade: "LM6",
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
          pouringWeight: parseWeightInput(formData.pouringWeight),
          alloyGrade: formData.alloyGrade,
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

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        if (data.success) setRole(data.user.role);
      } catch {
        // Only decides which buttons are offered; the API decides what is
        // actually allowed
      }
    })();
  }, []);

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
          pouringWeight: parseWeightInput(formData.pouringWeight),
          alloyGrade: formData.alloyGrade,
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
      // Blank stays blank - this part's gating has never been measured
      pouringWeight: part.pouringWeight ? weightToInput(part.pouringWeight) : "",
      alloyGrade: part.alloyGrade ?? "LM6",
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
          {canManage && (
            <Button onClick={() => setIsAddModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Part
            </Button>
          )}
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
              description={
                canManage
                  ? "Add your first part to get started with production tracking."
                  : "No parts have been added yet. Someone with parts access can add them."
              }
              action={
                canManage ? (
                  <Button onClick={() => setIsAddModalOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Part
                  </Button>
                ) : undefined
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
                      Pouring Weight
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Alloy
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
                      <td className="py-3 px-4">
                        {part.pouringWeight ? (
                          formatWeight(part.pouringWeight)
                        ) : (
                          <span className="text-sm text-[var(--muted-foreground)]">
                            Not recorded
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-2 text-sm">
                          <span
                            className={`h-2 w-2 rounded-full ${gradeSpec(part.alloyGrade).dotClass}`}
                          />
                          {part.alloyGrade}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {(() => {
                          const scrap = expectedScrapOf(part);
                          return scrap === null ? (
                            <span className="text-sm text-[var(--muted-foreground)]">
                              &mdash;
                            </span>
                          ) : (
                            formatWeight(scrap)
                          );
                        })()}
                      </td>
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
                          {canManage ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Edit this part"
                                onClick={() => openEditModal(part)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Remove this part"
                                onClick={() => {
                                  setSelectedPart(part);
                                  setIsDeleteModalOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-[var(--error)]" />
                              </Button>
                            </>
                          ) : (
                            <span className="text-sm text-[var(--muted-foreground)]">
                              &mdash;
                            </span>
                          )}
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
              placeholder="Finished casting weight"
              value={formData.weightPerPiece}
              onChange={(e) =>
                setFormData({ ...formData, weightPerPiece: e.target.value })
              }
              className="h-12"
            />
            {/* The mould takes more metal than the casting keeps - runners,
                risers and feeders are poured with it and cut off afterwards.
                Recording both figures is what lets the expected scrap below be
                worked out instead of guessed at. */}
            <Input
              label={`Pouring Weight (${WEIGHT_UNIT})`}
              type="number"
              placeholder="Metal poured, including gating"
              value={formData.pouringWeight}
              onChange={(e) =>
                setFormData({ ...formData, pouringWeight: e.target.value })
              }
              className="h-12"
            />

            {/* The alloy is asked for here, once, rather than on every fettling
                entry - a casting drawing specifies one. It decides which scrap
                line a rejected casting's metal is booked to. */}
            <div>
              <span className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                Alloy
              </span>
              <div className="inline-flex gap-1 rounded-lg bg-[var(--muted)] p-1">
                {ALLOY_GRADES.map((g) => {
                  const active = formData.alloyGrade === g.grade;
                  return (
                    <button
                      key={g.grade}
                      type="button"
                      onClick={() =>
                        setFormData({ ...formData, alloyGrade: g.grade })
                      }
                      className={`cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                          : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${g.dotClass}`} />
                        {g.grade}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
                {gradeSpec(formData.alloyGrade).description}. Rejected castings
                are booked to this grade&apos;s scrap.
              </p>
            </div>
            <ExpectedScrapReadout
              weightPerPiece={formData.weightPerPiece}
              pouringWeight={formData.pouringWeight}
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
              placeholder="Finished casting weight"
              value={formData.weightPerPiece}
              onChange={(e) =>
                setFormData({ ...formData, weightPerPiece: e.target.value })
              }
              className="h-12"
            />
            {/* The mould takes more metal than the casting keeps - runners,
                risers and feeders are poured with it and cut off afterwards.
                Recording both figures is what lets the expected scrap below be
                worked out instead of guessed at. */}
            <Input
              label={`Pouring Weight (${WEIGHT_UNIT})`}
              type="number"
              placeholder="Metal poured, including gating"
              value={formData.pouringWeight}
              onChange={(e) =>
                setFormData({ ...formData, pouringWeight: e.target.value })
              }
              className="h-12"
            />

            {/* The alloy is asked for here, once, rather than on every fettling
                entry - a casting drawing specifies one. It decides which scrap
                line a rejected casting's metal is booked to. */}
            <div>
              <span className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                Alloy
              </span>
              <div className="inline-flex gap-1 rounded-lg bg-[var(--muted)] p-1">
                {ALLOY_GRADES.map((g) => {
                  const active = formData.alloyGrade === g.grade;
                  return (
                    <button
                      key={g.grade}
                      type="button"
                      onClick={() =>
                        setFormData({ ...formData, alloyGrade: g.grade })
                      }
                      className={`cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                          : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${g.dotClass}`} />
                        {g.grade}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
                {gradeSpec(formData.alloyGrade).description}. Rejected castings
                are booked to this grade&apos;s scrap.
              </p>
            </div>
            <ExpectedScrapReadout
              weightPerPiece={formData.weightPerPiece}
              pouringWeight={formData.pouringWeight}
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
