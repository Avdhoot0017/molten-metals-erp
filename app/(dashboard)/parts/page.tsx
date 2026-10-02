"use client";

import * as React from "react";
import {
  AlertTriangle,
  Boxes,
  Check,
  Factory,
  PackageCheck,
  Plus,
  TrendingUp,
  Search,
  Edit,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import { RouteEditor, type RouteStepValue } from "@/components/route-editor";
import { canWrite } from "@/lib/permissions";
import { ALLOY_GRADES, gradeSpec } from "@/lib/ingot";
import type { UserRole } from "@/types";

/** One part's standing, as the shop-floor report works it out. */
interface PartStatus {
  id: string;
  inProcess: number;
  inRework: number;
  ready: number;
  castIn: number;
  finished: number;
  melted: number;
  bottleneck: { name: string; quantity: number } | null;
  stages: Array<{ stageKey: string; quantity: number }>;
  routeSteps: Array<{
    id: string;
    sequence: number;
    activityType: { id: string; name: string };
  }>;
}

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
  /** The stations its castings pass through, in order. */
  routeSteps?: Array<{
    id: string;
    sequence: number;
    activityTypeId: string;
    activityType: { id: string; name: string };
  }>;
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
  /**
   * The route being edited, held apart from formData: it is a list, not a
   * text field, and every other form value here is a string.
   */
  const [route, setRoute] = React.useState<RouteStepValue[]>([]);
  /**
   * Which half of the form is on screen.
   *
   * A part is two different things to fill in: figures typed into boxes, and a
   * route drawn out. Sharing one dialog left the drawing squeezed into a strip
   * at the bottom, so they take turns and each gets the whole width.
   */
  const [formStep, setFormStep] = React.useState<1 | 2>(1);

  /*
   * Filters, applied by the API so they cover the whole catalogue rather than
   * the ten rows on screen. Blank means "no opinion", which is why status
   * starts blank and the API's own default (working parts only) applies.
   */
  /** Catalogue-wide figures for the cards, counted by the API. */
  const [summary, setSummary] = React.useState<{
    parts: number;
    withoutSteps: number;
    totalMade: number;
    readyStock: number;
    mostMade: { partCode: string; name: string; quantity: number } | null;
  } | null>(null);
  const [filterStatus, setFilterStatus] = React.useState("");
  const [filterAlloy, setFilterAlloy] = React.useState("");


  /**
   * The "where is this part up to" popup.
   *
   * Written for the shop floor: whole sentences, no jargon, and the numbers
   * that answer "how many have we got and where are they" before anything
   * about grams or alloys.
   */
  const [detailsPart, setDetailsPart] = React.useState<Part | null>(null);
  const [details, setDetails] = React.useState<PartStatus | null>(null);
  const [detailsLoading, setDetailsLoading] = React.useState(false);

  const openDetails = async (part: Part) => {
    setDetailsPart(part);
    setDetails(null);
    setDetailsLoading(true);
    try {
      // The shop-floor report already works all of this out; with no dates it
      // covers everything from the start
      const res = await fetch(
        `/api/parts/stages/report?page=1&pageSize=50&search=${encodeURIComponent(part.partCode)}`
      );
      const data = await res.json();
      if (data.success) {
        setDetails(
          (data.data as PartStatus[]).find((row) => row.id === part.id) ?? null
        );
      }
    } catch {
      // The popup still shows what the part IS, just not where its pieces are
    } finally {
      setDetailsLoading(false);
    }
  };
  const [processes, setProcesses] = React.useState<
    Array<{ id: string; name: string }>
  >([]);

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
      // The cards describe the whole catalogue, so they are asked for with
      // the page rather than fetched separately
      params.set("summary", "1");
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (filterStatus) params.set("status", filterStatus);
      if (filterAlloy) params.set("alloy", filterAlloy);


      const response = await fetch(`/api/parts?${params.toString()}`);
      const data = await response.json();
      if (data.success) {
        setParts(data.data);
        setPagination(data.pagination ?? null);
        if (data.summary) setSummary(data.summary);
      }
    } catch (err) {
      console.error("Error fetching parts:", err);
    } finally {
      setIsPageLoading(false);
    }
  }, [page, pageSize, debouncedSearch, filterStatus, filterAlloy]);

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
    setRoute([]);
    setFormStep(1);
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
          // Order is the meaning - position in this list becomes the sequence
          route: route.map((step) => step.activityTypeId),
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

  // The processes a route can be built from. Admin-managed in Settings, so
  // they are read rather than hard-coded.
  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/activity-types");
        const data = await res.json();
        if (data.success) {
          setProcesses(
            (data.data as Array<{ id: string; name: string; isActive: boolean }>)
              .filter((a) => a.isActive)
              .map((a) => ({ id: a.id, name: a.name }))
          );
        }
      } catch {
        // The route editor simply offers nothing to add; the part still saves
      }
    })();
  }, []);

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
          // Order is the meaning - position in this list becomes the sequence
          route: route.map((step) => step.activityTypeId),
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
    setRoute(
      (part.routeSteps ?? []).map((step) => ({
        activityTypeId: step.activityTypeId,
        name: step.activityType.name,
      }))
    );
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

      {/* Figures about the catalogue as a whole, counted in the database.
          The old cards read "Total Parts 10, Active Parts 17" - one counted
          the page on screen, the other the catalogue, so the total came out
          smaller than its own subset. Active/inactive is a filter now, not a
          headline. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Parts we make",
            value: summary ? summary.parts.toLocaleString("en-IN") : "-",
            hint: "in the catalogue",
            icon: Boxes,
          },
          {
            label: "Most made",
            value: summary?.mostMade
              ? summary.mostMade.quantity.toLocaleString("en-IN")
              : "-",
            hint: summary?.mostMade
              ? `${summary.mostMade.partCode} - ${summary.mostMade.name}`
              : "nothing cast yet",
            icon: TrendingUp,
          },
          {
            label: "Made so far",
            value: summary ? summary.totalMade.toLocaleString("en-IN") : "-",
            hint: "all parts, all time",
            icon: Factory,
          },
          {
            label: "Ready to send",
            value: summary ? summary.readyStock.toLocaleString("en-IN") : "-",
            hint: "finished and waiting",
            icon: PackageCheck,
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

      {/* Parts nobody has mapped out cannot be followed through the shop, so
          it is worth saying out loud rather than leaving in a filter */}
      {summary && summary.withoutSteps > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {summary.withoutSteps} part
            {summary.withoutSteps === 1 ? " has" : "s have"} no work steps set,
            so their castings go straight to finished and cannot be followed
            bench by bench.
          </span>
        </div>
      )}

      {/* Search and filters. Plain words, and every one of them narrows the
          whole catalogue rather than the page on screen. */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Search by name or code..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="pl-10"
              />
            </div>
            <Select
              options={[
                { value: "", label: "Parts in use" },
                { value: "inactive", label: "Retired parts" },
                { value: "all", label: "All parts" },
              ]}
              value={filterStatus}
              onChange={(value) => {
                setFilterStatus(value);
                setPage(1);
              }}
            />
            <Select
              options={[
                { value: "", label: "Any metal" },
                ...ALLOY_GRADES.map((g) => ({ value: g.grade, label: g.grade })),
              ]}
              value={filterAlloy}
              onChange={(value) => {
                setFilterAlloy(value);
                setPage(1);
              }}
            />
          </div>

          {(searchQuery || filterStatus || filterAlloy) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setFilterStatus("");
                setFilterAlloy("");
                setPage(1);
              }}
              className="mt-3 cursor-pointer text-sm text-[var(--primary)] hover:underline"
            >
              Clear filters
            </button>
          )}
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
            /* Same shape as every other list in the app: short plain
               headings that stay on one line, the header pinned while the
               rows scroll under it, and a fixed height so a long catalogue
               does not push the page away. */
            <div className="max-h-[32rem] overflow-auto rounded-lg border border-[var(--border)]">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[var(--card)]">
                  <tr className="border-b border-[var(--border)]">
                    {[
                      "Code",
                      "Part",
                      "Weight",
                      "Poured",
                      "Metal",
                      "Steps",
                      "Scrap",
                      "Status",
                      "Added",
                      "",
                    ].map((heading, index) => (
                      <th
                        key={heading || `actions-${index}`}
                        className="whitespace-nowrap px-4 py-3 text-left text-sm font-semibold"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredParts.map((part) => (
                    <tr
                      key={part.id}
                      className="border-b border-[var(--border)] hover:bg-[var(--muted)]"
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="font-mono text-sm bg-[var(--muted)] px-2 py-1 rounded">
                          {part.partCode}
                        </span>
                      </td>
                      <td
                        className="max-w-xs truncate px-4 py-3 font-medium"
                        title={
                          part.description
                            ? `${part.name} - ${part.description}`
                            : part.name
                        }
                      >
                        {part.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatWeight(part.weightPerPiece)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {part.pouringWeight ? (
                          formatWeight(part.pouringWeight)
                        ) : (
                          <span className="text-sm text-[var(--muted-foreground)]">
                            Not set
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex items-center gap-2 text-sm">
                          <span
                            className={`h-2 w-2 rounded-full ${gradeSpec(part.alloyGrade).dotClass}`}
                          />
                          {part.alloyGrade}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {/* The route at a glance. A part with none cannot be
                            tracked through the shop, so it is called out
                            rather than left blank. */}
                        {part.routeSteps && part.routeSteps.length > 0 ? (
                          <span
                            className="text-sm"
                            title={part.routeSteps
                              .map((r) => r.activityType.name)
                              .join(" -> ")}
                          >
                            {part.routeSteps.length} step
                            {part.routeSteps.length === 1 ? "" : "s"}
                            <span className="ml-1 text-xs text-[var(--muted-foreground)]">
                              {part.routeSteps[0].activityType.name}
                              {part.routeSteps.length > 1 && " ..."}
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm text-amber-700">Not set</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
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
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge variant={part.isActive ? "success" : "secondary"}>
                          {part.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-[var(--muted-foreground)]">
                        {formatDate(new Date(part.createdAt))}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* Looking is not editing, so this is offered to
                              everyone - including the roles whose actions
                              column was otherwise just a dash */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void openDetails(part)}
                          >
                            Details
                          </Button>
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
                          ) : null}
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

      {/* What this part is, and where its pieces have got to.
          Plain words on purpose: the people reading it are at a bench, not a
          desk, and "WIP at station 2" tells them nothing. */}
      <Modal
        isOpen={detailsPart !== null}
        onClose={() => setDetailsPart(null)}
        title={detailsPart ? detailsPart.name : ""}
        description={detailsPart ? `Part number ${detailsPart.partCode}` : ""}
        size="lg"
      >
        {detailsPart && (
          <div className="space-y-5">
            {detailsLoading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : (
              <>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-[var(--foreground)]">
                    How many we have now
                  </h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="text-2xl font-semibold text-blue-700">
                        {details?.inProcess ?? 0}
                      </p>
                      <p className="text-xs text-blue-900">Still being worked on</p>
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-2xl font-semibold text-amber-700">
                        {details?.inRework ?? 0}
                      </p>
                      <p className="text-xs text-amber-900">Waiting for repair</p>
                    </div>
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                      <p className="text-2xl font-semibold text-green-700">
                        {details?.ready ?? 0}
                      </p>
                      <p className="text-xs text-green-900">
                        Finished and ready
                      </p>
                    </div>
                  </div>
                  {(details?.ready ?? 0) > 0 && (
                    <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                      The finished ones weigh{" "}
                      {formatWeight((details?.ready ?? 0) * detailsPart.weightPerPiece)}{" "}
                      altogether.
                    </p>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-semibold text-[var(--foreground)]">
                    Where they are
                  </h4>
                  {(details?.routeSteps.length ?? 0) === 0 ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      No work steps have been set for this part yet, so new
                      castings go straight to finished. Use Edit to add the
                      steps it goes through.
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                      <table className="w-full">
                        <tbody>
                          {details?.routeSteps.map((step) => {
                            const waiting =
                              details.stages.find(
                                (x) => x.stageKey === `STEP:${step.id}`
                              )?.quantity ?? 0;
                            const repair =
                              details.stages.find(
                                (x) => x.stageKey === `REWORK:${step.id}`
                              )?.quantity ?? 0;
                            return (
                              <tr
                                key={step.id}
                                className="border-b border-[var(--border)] last:border-0"
                              >
                                <td className="px-4 py-2.5 text-sm">
                                  <span className="mr-2 text-[var(--muted-foreground)]">
                                    {step.sequence}.
                                  </span>
                                  {step.activityType.name}
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm">
                                  {waiting > 0 ? (
                                    <span className="font-semibold">
                                      {waiting} waiting
                                    </span>
                                  ) : (
                                    <span className="text-[var(--muted-foreground)]">
                                      nothing waiting
                                    </span>
                                  )}
                                  {repair > 0 && (
                                    <span className="ml-2 text-amber-700">
                                      {repair} to repair
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-semibold text-[var(--foreground)]">
                    Since we started making it
                  </h4>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-lg bg-[var(--muted)] p-3">
                      <p className="text-lg font-semibold">{details?.castIn ?? 0}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Made in the furnace
                      </p>
                    </div>
                    <div className="rounded-lg bg-[var(--muted)] p-3">
                      <p className="text-lg font-semibold">{details?.finished ?? 0}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Got all the way through
                      </p>
                    </div>
                    <div className="rounded-lg bg-[var(--muted)] p-3">
                      <p className="text-lg font-semibold text-[var(--error)]">
                        {details?.melted ?? 0}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Sent back to the furnace
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-semibold text-[var(--foreground)]">
                    About this part
                  </h4>
                  <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                    <table className="w-full">
                      <tbody>
                        {[
                          {
                            label: "Metal poured for one piece",
                            value: detailsPart.pouringWeight
                              ? formatWeight(detailsPart.pouringWeight)
                              : "Not set yet",
                          },
                          {
                            label: "What one finished piece weighs",
                            value: formatWeight(detailsPart.weightPerPiece),
                          },
                          {
                            label: "Cut off each piece as scrap",
                            value: (() => {
                              const scrap = expectedScrapOf(detailsPart);
                              return scrap === null ? "Not known yet" : formatWeight(scrap);
                            })(),
                          },
                          { label: "Metal it is cast in", value: detailsPart.alloyGrade },
                        ].map((row) => (
                          <tr
                            key={row.label}
                            className="border-b border-[var(--border)] last:border-0"
                          >
                            <td className="px-4 py-2.5 text-sm text-[var(--muted-foreground)]">
                              {row.label}
                            </td>
                            <td className="px-4 py-2.5 text-right text-sm font-medium">
                              {row.value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {detailsPart.description && (
                    <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                      {detailsPart.description}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDetailsPart(null)}>
            Close
          </Button>
          {canManage && detailsPart && (
            <Button
              onClick={() => {
                const part = detailsPart;
                setDetailsPart(null);
                openEditModal(part);
              }}
            >
              <Edit className="h-4 w-4 mr-2" />
              Edit this part
            </Button>
          )}
        </ModalFooter>
      </Modal>

      {/* Add Part Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          resetForm();
        }}
        title="Add New Part"
        description="Create a new part for manufacturing"
        size="xl"
      >
        <div className="space-y-4 pb-2">
          {error && (
            <div className="p-4 rounded-lg bg-[var(--error-light)] border border-[var(--error)] text-[var(--error)] text-sm">
              {error}
            </div>
          )}

          {/* Where you are in the form, not a control: circles joined by a
              line, moved through with the buttons below. Steps that look
              pressable invite a click mid-entry and lose the place. */}
          <div className="flex items-start px-6 pb-1 pt-1">
            {([
              { n: 1 as const, title: "Part details", hint: "Code, weights and alloy" },
              {
                n: 2 as const,
                title: "Process route",
                hint:
                  route.length > 0
                    ? `${route.length} step${route.length === 1 ? "" : "s"}`
                    : "Not set yet",
              },
            ]).map((step, index, all) => {
              const done = formStep > step.n;
              const active = formStep === step.n;
              return (
                <React.Fragment key={step.n}>
                  <div className="flex w-32 shrink-0 flex-col items-center text-center">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors ${
                        done
                          ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                          : active
                          ? "border-[var(--primary)] bg-[var(--card)] text-[var(--primary)]"
                          : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]"
                      }`}
                    >
                      {done ? <Check className="h-4 w-4" /> : step.n}
                    </span>
                    <span
                      className={`mt-2 text-sm font-medium ${
                        active || done
                          ? "text-[var(--foreground)]"
                          : "text-[var(--muted-foreground)]"
                      }`}
                    >
                      {step.title}
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {step.hint}
                    </span>
                  </div>
                  {/* The rule joining them, pinned to the middle of the
                      circles rather than the middle of the labels below */}
                  {index < all.length - 1 && (
                    <span
                      className={`mt-[18px] h-0.5 flex-1 rounded transition-colors ${
                        done ? "bg-[var(--primary)]" : "bg-[var(--border)]"
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          <div className={formStep === 1 ? "grid grid-cols-2 gap-4" : "hidden"}>
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
            {/* Poured first, then what is left. The mould takes more metal
                than the casting keeps - runners, risers and feeders are poured
                with it and cut off afterwards - so the two are asked for in the
                order the metal actually goes through them, and the expected
                scrap below falls out of the pair. */}
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

          {/* Mounted only while it is the step on screen.
              Kept mounted-but-hidden, the canvas measures itself at zero size,
              fits the view to nothing, and opens off-centre at a strange zoom
              when the step is finally shown. */}
          {formStep === 2 && (
            <RouteEditor
              value={route}
              processes={processes}
              onChange={setRoute}
              height={420}
            />
          )}
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
          {formStep === 1 ? (
            <Button className="h-12" onClick={() => setFormStep(2)}>
              Next: Process route
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                className="h-12"
                onClick={() => setFormStep(1)}
              >
                Back
              </Button>
              <Button className="h-12" onClick={handleAddPart} isLoading={isLoading}>
                <Plus className="h-4 w-4 mr-2" />
                Add Part
              </Button>
            </>
          )}
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
        size="xl"
      >
        <div className="space-y-4 pb-2">
          {error && (
            <div className="p-4 rounded-lg bg-[var(--error-light)] border border-[var(--error)] text-[var(--error)] text-sm">
              {error}
            </div>
          )}

          {/* Where you are in the form, not a control: circles joined by a
              line, moved through with the buttons below. Steps that look
              pressable invite a click mid-entry and lose the place. */}
          <div className="flex items-start px-6 pb-1 pt-1">
            {([
              { n: 1 as const, title: "Part details", hint: "Code, weights and alloy" },
              {
                n: 2 as const,
                title: "Process route",
                hint:
                  route.length > 0
                    ? `${route.length} step${route.length === 1 ? "" : "s"}`
                    : "Not set yet",
              },
            ]).map((step, index, all) => {
              const done = formStep > step.n;
              const active = formStep === step.n;
              return (
                <React.Fragment key={step.n}>
                  <div className="flex w-32 shrink-0 flex-col items-center text-center">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors ${
                        done
                          ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                          : active
                          ? "border-[var(--primary)] bg-[var(--card)] text-[var(--primary)]"
                          : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]"
                      }`}
                    >
                      {done ? <Check className="h-4 w-4" /> : step.n}
                    </span>
                    <span
                      className={`mt-2 text-sm font-medium ${
                        active || done
                          ? "text-[var(--foreground)]"
                          : "text-[var(--muted-foreground)]"
                      }`}
                    >
                      {step.title}
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {step.hint}
                    </span>
                  </div>
                  {/* The rule joining them, pinned to the middle of the
                      circles rather than the middle of the labels below */}
                  {index < all.length - 1 && (
                    <span
                      className={`mt-[18px] h-0.5 flex-1 rounded transition-colors ${
                        done ? "bg-[var(--primary)]" : "bg-[var(--border)]"
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          <div className={formStep === 1 ? "grid grid-cols-2 gap-4" : "hidden"}>
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
            {/* Poured first, then what is left. The mould takes more metal
                than the casting keeps - runners, risers and feeders are poured
                with it and cut off afterwards - so the two are asked for in the
                order the metal actually goes through them, and the expected
                scrap below falls out of the pair. */}
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

          {/* Mounted only while it is the step on screen.
              Kept mounted-but-hidden, the canvas measures itself at zero size,
              fits the view to nothing, and opens off-centre at a strange zoom
              when the step is finally shown. */}
          {formStep === 2 && (
            <RouteEditor
              value={route}
              processes={processes}
              onChange={setRoute}
              height={420}
            />
          )}
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
          {formStep === 1 ? (
            <Button className="h-12" onClick={() => setFormStep(2)}>
              Next: Process route
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                className="h-12"
                onClick={() => setFormStep(1)}
              >
                Back
              </Button>
              <Button className="h-12" onClick={handleEditPart} isLoading={isLoading}>
                Save Changes
              </Button>
            </>
          )}
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
