"use client";

import * as React from "react";
import {
  Factory,
  Plus,
  Search,
  Filter,
  Download,
  Eye,
  TrendingUp,
  Package,
  AlertTriangle,
  Recycle,
  Flame,
  FlaskConical,
  X,
  RefreshCw,
  CheckCircle2,
  Clock,
  FlaskRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stat-card";
import { LoadingSpinner } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { formatWeight, formatDate, formatDateTime } from "@/lib/utils";
import { Pagination, type PaginationMeta } from "@/components/ui/pagination";
import {
  calculateDensityIndex,
  validateDensityPair,
  formatDensityIndex,
} from "@/lib/density-index";
import {
  exportToExcel,
  fetchAllPages,
  timestampedFilename,
  sheet,
} from "@/lib/export-excel";
import {
  readComposition,
  compositionToInputs,
  buildCompositionEntries,
  aluminiumBalance,
  checkElementValue,
  LM6_ELEMENTS,
} from "@/lib/composition";
import {
  INGOT_GRADES,
  SCRAP_FORMS,
  gradeName,
  materialType,
  type MaterialForm,
} from "@/lib/ingot";

/**
 * Which form-state field holds the re-melt weight for each scrap form. The
 * grade is not part of the key: a batch runs on one alloy, so the selected
 * grade decides which stock line the weight moves.
 */
/** Title, blurb and button for each of the three entry stages. */
const MODAL_COPY: Record<
  "create" | "melt" | "complete" | "amend",
  { title: string; description: string; action: string }
> = {
  amend: {
    title: "Update Batch",
    description:
      "The whole batch, as recorded. Correct anything - stock moves by the difference.",
    action: "Save Changes",
  },
  create: {
    title: "New Production Batch",
    description: "Record what went into the furnace. The rest is added later.",
    action: "Create Batch",
  },
  melt: {
    title: "Melt Reading",
    description: "Add the composition and density index for this heat.",
    action: "Save Reading",
  },
  complete: {
    title: "Complete Batch",
    description: "Count the castings and book the scrap this batch produced.",
    action: "Complete Batch",
  },
};

const SCRAP_USED_FIELD: Record<
  Exclude<MaterialForm, "INGOT">,
  "runnerRaiserScrapUsed" | "spillageScrapUsed" | "rejectedPartScrapUsed"
> = {
  RUNNER_RAISER: "runnerRaiserScrapUsed",
  SPILLAGE: "spillageScrapUsed",
  REJECTED_PART: "rejectedPartScrapUsed",
};
import type { AluminumType } from "@/types";
import { MAX_OPEN_BATCHES_PER_FURNACE } from "@/lib/production";
import {
  parseWeightInput,
  weightForExport,
  weightToInput,
  WEIGHT_UNIT,
} from "@/lib/units";

interface Part {
  id: string;
  partCode: string;
  name: string;
  weightPerPiece: number;
}

/** One part line inside the batch being entered. */
interface PartLine {
  partId: string;
  quantityProduced: string;
  goodParts: string;
}

/**
 * Whether a stored composition reading sits inside its LM6 limit. Stored values
 * carry a "%" suffix, and a batch may hold elements outside the table (older
 * batches allowed free-form keys), so anything unrecognised is left unjudged
 * rather than flagged.
 */
function compositionSpecStatus(key: string, value: string): "in" | "out" | "unknown" {
  const element = LM6_ELEMENTS.find(
    (e) => e.symbol.toLowerCase() === key.toLowerCase()
  );
  if (!element || element.isRemainder) return "unknown";

  const num = Number(value.replace("%", "").trim());
  if (!Number.isFinite(num)) return "unknown";
  if (element.min !== undefined && num < element.min) return "out";
  if (element.max !== undefined && num > element.max) return "out";
  return "in";
}

type ProductionStatus = "PENDING" | "UPDATED" | "COMPLETED";

/** How each status reads on screen. Order matches the entry stages. */
const STATUS_META: Record<
  ProductionStatus,
  { label: string; className: string; hint: string }
> = {
  PENDING: {
    label: "Pending",
    className: "bg-amber-100 text-amber-700 border-amber-200",
    hint: "Charged - melt reading not taken yet",
  },
  UPDATED: {
    label: "Updated",
    className: "bg-blue-100 text-blue-700 border-blue-200",
    hint: "Melt read - castings not counted yet",
  },
  COMPLETED: {
    label: "Completed",
    className: "bg-emerald-100 text-emerald-700 border-emerald-200",
    hint: "Closed",
  },
};

interface ProductionRecord {
  id: string;
  batchNumber: string;
  status: ProductionStatus;
  items: Array<{
    id: string;
    partId: string;
    quantityProduced: number;
    goodParts: number;
    rejectedParts: number;
    part: {
      id: string;
      name: string;
      partCode: string;
      weightPerPiece: number;
    };
  }>;
  furnace?: { id: string; name: string } | null;
  composition?: unknown;
  densityAtmospheric?: number | null;
  densityVacuum?: number | null;
  densityIndex?: number | null;
  date: string;
  aluminumUsed: number;
  /** The alloy the heat was run on - also the grade of its scrap. */
  ingotGrade: AluminumType;
  aluminumUsedLM6: number;
  aluminumUsedLM9: number;
  aluminumUsedLM25: number;
  // Defaulted to 0 server-side, so batches saved before scrap re-melt was
  // tracked still satisfy this.
  runnerRaiserScrapUsed: number;
  spillageScrapUsed: number;
  rejectedPartScrapUsed: number;
  totalScrapUsed: number;
  quantityProduced: number;
  goodParts: number;
  rejectedParts: number;
  runnerRaiserScrap: number;
  spillageScrap: number;
  rejectedPartScrap: number;
  totalScrap: number;
  efficiency: number;
  notes?: string;
  user: {
    name: string;
  };
  createdAt: string;
}

export default function ProductionPage() {
  /**
   * A batch is entered over three moments, not one form. `batchModal` says
   * which of them is open, and `editingRecord` is the batch being carried
   * forward (null when a new one is being charged).
   */
  const [batchModal, setBatchModal] = React.useState<
    "create" | "melt" | "complete" | "amend" | null
  >(null);
  const [editingRecord, setEditingRecord] =
    React.useState<ProductionRecord | null>(null);
  // Which list is showing: finished batches, or ones still on the floor
  const [listTab, setListTab] = React.useState<"completed" | "inProgress">(
    "completed"
  );
  const [isViewModalOpen, setIsViewModalOpen] = React.useState(false);
  const [selectedRecord, setSelectedRecord] = React.useState<ProductionRecord | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [pagination, setPagination] = React.useState<PaginationMeta | null>(null);

  // Filter panel
  const [showFilters, setShowFilters] = React.useState(false);
  const [filterFurnaceId, setFilterFurnaceId] = React.useState("ALL");
  const [filterFrom, setFilterFrom] = React.useState("");
  const [filterTo, setFilterTo] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isPageLoading, setIsPageLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  // Data state
  const [parts, setParts] = React.useState<Part[]>([]);
  // Live stock for every material line - ingot and scrap, per grade
  const [stockByType, setStockByType] = React.useState<
    Partial<Record<AluminumType, number>>
  >({});
  const [records, setRecords] = React.useState<ProductionRecord[]>([]);

  // Form state
  const [formData, setFormData] = React.useState({
    furnaceId: "",
    // A heat is charged with one alloy, so the grade is picked once and the
    // weight is entered against it. The API still takes a per-grade split;
    // the other two grades go over as zero.
    ingotGrade: "INGOT_LM6" as AluminumType,
    aluminumUsed: "",
    runnerRaiserScrapUsed: "",
    spillageScrapUsed: "",
    rejectedPartScrapUsed: "",
    densityAtmospheric: "",
    densityVacuum: "",
    runnerRaiserScrap: "",
    spillageScrap: "",
    rejectedPartScrap: "",
    notes: "",
  });

  // One line per part in the batch, shown as removable chips
  const [partLines, setPartLines] = React.useState<PartLine[]>([]);
  const [partToAdd, setPartToAdd] = React.useState("");

  // Fixed LM6 element readings, keyed by chemical symbol
  const [elementValues, setElementValues] = React.useState<Record<string, string>>({});
  // Aluminium is auto-filled with the balance until the operator types their
  // own figure - an assay that only covers a few elements makes the computed
  // balance a guess, so they must be able to overrule it.
  const [alIsAuto, setAlIsAuto] = React.useState(true);
  const [isExporting, setIsExporting] = React.useState(false);
  // Only an admin may reopen a completed batch, so the row's actions depend
  // on who is looking. Read once; the API enforces it regardless.
  const [role, setRole] = React.useState<string | null>(null);
  const [furnaces, setFurnaces] = React.useState<
    Array<{ id: string; name: string; openBatches: number }>
  >([]);
  // True when the stock lookup failed, so "0 kg" is not shown as if it were
  // a real reading
  const [stockLoadFailed, setStockLoadFailed] = React.useState(false);

  // Debounce typing so the API is not hit on every keystroke
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  /** Parts, furnaces and stock feed the form, so they load unpaginated. */
  const fetchLookups = React.useCallback(async () => {
    const [partsRes, furnacesRes, stockRes] = await Promise.all([
      fetch("/api/parts"),
      fetch("/api/furnaces"),
      // Stock comes from the production-scoped endpoint, not /api/inventory:
      // a production manager charges furnaces without holding inventory
      // access, and reading 0 kg for every grade would block them entirely.
      fetch("/api/production/stock"),
    ]);
    const partsData = await partsRes.json();
    const furnacesData = await furnacesRes.json();
    const stockData = await stockRes.json();
    if (partsData.success) setParts(partsData.data);
    if (furnacesData.success) setFurnaces(furnacesData.data || []);
    if (Array.isArray(stockData.data)) {
      // Stock per grade and form, so the form can show what may be charged
      setStockByType(
        Object.fromEntries(
          stockData.data.map((i: { type: AluminumType; quantity: number }) => [
            i.type,
            i.quantity,
          ])
        )
      );
      setStockLoadFailed(false);
    } else {
      // Never let a failed lookup masquerade as "nothing in stock" - that
      // reads as a supply problem when it is an access or network one
      setStockLoadFailed(true);
    }
  }, []);

  const fetchRecords = React.useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (filterFurnaceId !== "ALL") params.set("furnaceId", filterFurnaceId);
    if (filterFrom) params.set("from", filterFrom);
    if (filterTo) params.set("to", filterTo);
    // The list is paged in the database, so the tab has to filter there too -
    // filtering the current page client-side would show the wrong counts
    params.set("status", listTab === "completed" ? "COMPLETED" : "IN_PROGRESS");

    const res = await fetch(`/api/production?${params.toString()}`);
    const data = await res.json();
    if (data.success) {
      setRecords(data.data);
      setPagination(data.pagination ?? null);
    }
  }, [page, pageSize, debouncedSearch, filterFurnaceId, filterFrom, filterTo, listTab]);

  const fetchData = async () => {
    setIsPageLoading(true);
    try {
      await Promise.all([fetchLookups(), fetchRecords()]);
    } catch (err) {
      console.error("Error fetching data:", err);
      setError("Failed to load data");
    } finally {
      setIsPageLoading(false);
    }
  };

  // Lookups load once; records reload whenever paging or filters change
  React.useEffect(() => {
    void (async () => {
      await fetchLookups();
    })();
  }, [fetchLookups]);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        if (data.success) setRole(data.user.role);
      } catch {
        // Only decides whether the amend buttons are offered; the API decides
        // whether they are allowed
      }
    })();
  }, []);

  React.useEffect(() => {
    void (async () => {
      setIsPageLoading(true);
      try {
        await fetchRecords();
      } finally {
        setIsPageLoading(false);
      }
    })();
  }, [fetchRecords]);


  const partOptions = parts.map((part) => ({
    value: part.id,
    label: `${part.name} (${formatWeight(part.weightPerPiece)}/pc)`,
  }));

  const isAdmin = role === "ADMIN";
  // An amendment is not a stage - it is the whole batch at once, so every
  // section shows and the admin can correct whichever part is wrong
  const showCharge = batchModal === "create" || batchModal === "amend";
  const showMelt = batchModal === "melt" || batchModal === "amend";
  const showOutput = batchModal === "complete" || batchModal === "amend";
  const isAmending = batchModal === "amend";
  const furnaceOptions = furnaces.map((f) => ({ value: f.id, label: f.name }));
  // A furnace at its limit cannot take another batch until some are closed
  const selectedFurnace = furnaces.find((f) => f.id === formData.furnaceId);
  const furnaceIsFull =
    (selectedFurnace?.openBatches ?? 0) >= MAX_OPEN_BATCHES_PER_FURNACE;
  // A stock figure that never loaded is not evidence of an empty line, so the
  // client-side over-draw checks stand down and the API has the final say
  const stockKnown = !stockLoadFailed;

  // A part can only be added to the batch once
  const availablePartOptions = partOptions.filter(
    (option) => !partLines.some((line) => line.partId === option.value)
  );

  // Rows arrive already searched, filtered and paged by the API
  const filteredRecords = records;

  // Live DI preview, using the same helper the API uses
  const densityPairEntered =
    formData.densityAtmospheric !== "" && formData.densityVacuum !== "";
  const previewDensityIndex = densityPairEntered
    ? calculateDensityIndex(
        parseFloat(formData.densityAtmospheric),
        parseFloat(formData.densityVacuum)
      )
    : null;
  const densityPairError = densityPairEntered
    ? validateDensityPair(
        parseFloat(formData.densityAtmospheric),
        parseFloat(formData.densityVacuum)
      )
    : null;

  const activeFilterCount =
    (filterFurnaceId !== "ALL" ? 1 : 0) + (filterFrom ? 1 : 0) + (filterTo ? 1 : 0);

  const todayStr = formatDate(new Date());
  const todayProduction = records
    .filter((r) => formatDate(new Date(r.date)) === todayStr)
    .reduce((sum, r) => sum + r.goodParts, 0);

  const avgEfficiency = records.length > 0
    ? records.reduce((sum, r) => sum + r.efficiency, 0) / records.length
    : 0;

  const totalScrap = records.reduce((sum, r) => sum + r.totalScrap, 0);

  // What is going into the furnace for the batch being entered: fresh ingot
  // plus any scrap re-melted with it.
  const ingotChargeTotal = parseWeightInput(formData.aluminumUsed);
  // Al is auto-filled from the balance, so it does not count as a reading
  const enteredElementCount = LM6_ELEMENTS.filter(
    (e) => e.symbol !== "Al" && (elementValues[e.symbol] ?? "").trim() !== ""
  ).length;
  const selectedGrade =
    INGOT_GRADES.find((g) => g.type === formData.ingotGrade) ?? INGOT_GRADES[0];
  const selectedGradeStock = stockByType[formData.ingotGrade] ?? 0;
  const scrapUsedTotal =
    parseWeightInput(formData.runnerRaiserScrapUsed) +
    parseWeightInput(formData.spillageScrapUsed) +
    parseWeightInput(formData.rejectedPartScrapUsed);
  const totalCharge = ingotChargeTotal + scrapUsedTotal;

  const resetForm = () => {
    setFormData({
      furnaceId: "",
      ingotGrade: "INGOT_LM6" as AluminumType,
      aluminumUsed: "",
      runnerRaiserScrapUsed: "",
      spillageScrapUsed: "",
      rejectedPartScrapUsed: "",
      densityAtmospheric: "",
      densityVacuum: "",
      runnerRaiserScrap: "",
      spillageScrap: "",
      rejectedPartScrap: "",
      notes: "",
    });
    setPartLines([]);
    setPartToAdd("");
    setElementValues({});
    setAlIsAuto(true);
    setError("");
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      // Export the whole filtered result set, not just the page on screen
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterFurnaceId !== "ALL") params.furnaceId = filterFurnaceId;
      if (filterFrom) params.from = filterFrom;
      if (filterTo) params.to = filterTo;

      const records = await fetchAllPages<ProductionRecord>(
        "/api/production",
        params
      );

      await exportToExcel(timestampedFilename("production-batches"), [
        sheet<ProductionRecord>({
          name: "Production Batches",
          rows: records,
          columns: [
            { header: "Batch Number", value: (r) => r.batchNumber, width: 22 },
            { header: "Date", value: (r) => formatDate(new Date(r.date)), width: 14 },
            { header: "Furnace", value: (r) => r.furnace?.name ?? "" },
            {
              header: "Parts",
              value: (r) =>
                r.items.map((i) => `${i.part.partCode} x${i.quantityProduced}`).join(", "),
              width: 38,
            },
            { header: "Produced", value: (r) => r.quantityProduced },
            { header: "Good", value: (r) => r.goodParts },
            { header: "Rejected", value: (r) => r.rejectedParts },
            { header: "Aluminium Used (kg)", value: (r) => weightForExport(r.aluminumUsed), width: 18 },
            { header: "LM6 (kg)", value: (r) => weightForExport(r.aluminumUsedLM6), width: 12 },
            { header: "LM9 (kg)", value: (r) => weightForExport(r.aluminumUsedLM9), width: 12 },
            { header: "LM25 (kg)", value: (r) => weightForExport(r.aluminumUsedLM25), width: 12 },
            { header: "Runner & Raiser (kg)", value: (r) => weightForExport(r.runnerRaiserScrap), width: 18 },
            { header: "Spillage (kg)", value: (r) => weightForExport(r.spillageScrap) },
            { header: "Rejected Part (kg)", value: (r) => weightForExport(r.rejectedPartScrap), width: 18 },
            { header: "Total Scrap (kg)", value: (r) => weightForExport(r.totalScrap), width: 16 },
            { header: "Scrap Re-melted (kg)", value: (r) => weightForExport(r.totalScrapUsed), width: 20 },
            {
              header: "Efficiency (%)",
              value: (r) => Number(r.efficiency.toFixed(2)),
              width: 14,
            },
            {
              header: "Density Index (%)",
              value: (r) =>
                r.densityIndex != null ? Number(r.densityIndex.toFixed(2)) : "",
              width: 16,
            },
            { header: "Density ρA", value: (r) => r.densityAtmospheric ?? "" },
            { header: "Density ρB", value: (r) => r.densityVacuum ?? "" },
            {
              header: "Composition",
              value: (r) =>
                readComposition(r.composition)
                  .map((c) => `${c.key}: ${c.value}`)
                  .join(", "),
              width: 38,
            },
            { header: "Recorded By", value: (r) => r.user?.name ?? "", width: 18 },
            { header: "Notes", value: (r) => r.notes ?? "", width: 30 },
          ],
        }),
      ]);
    } catch (err) {
      console.error("Export failed:", err);
      setError("Failed to export production batches");
    } finally {
      setIsExporting(false);
    }
  };

  /**
   * Writes one element reading and, while aluminium is still on auto, refreshes
   * it from the new balance. An impossible balance is left blank rather than
   * shown as a negative percentage.
   */
  const setElementValue = (symbol: string, value: string) => {
    setElementValues((current) => {
      const next = { ...current, [symbol]: value };
      if (symbol === "Al" || !alIsAuto) return next;

      const { balance, overflow } = aluminiumBalance(next);
      next.Al = balance === null || overflow ? "" : String(balance);
      return next;
    });
  };

  /** Hands aluminium back to the computed balance after a manual override. */
  const restoreAutoAluminium = () => {
    setAlIsAuto(true);
    setElementValues((current) => {
      const { balance, overflow } = aluminiumBalance(current);
      return { ...current, Al: balance === null || overflow ? "" : String(balance) };
    });
  };


  const addPartLine = (partId: string) => {
    if (!partId || partLines.some((l) => l.partId === partId)) return;
    setPartLines((lines) => [...lines, { partId, quantityProduced: "", goodParts: "" }]);
    setPartToAdd("");
  };

  const removePartLine = (partId: string) => {
    setPartLines((lines) => lines.filter((l) => l.partId !== partId));
  };

  const updatePartLine = (partId: string, patch: Partial<PartLine>) => {
    setPartLines((lines) =>
      lines.map((l) => (l.partId === partId ? { ...l, ...patch } : l))
    );
  };

  // Batch totals, derived from the lines
  const batchTotals = partLines.reduce(
    (acc, line) => {
      const qty = parseInt(line.quantityProduced) || 0;
      const good = parseInt(line.goodParts) || 0;
      return {
        quantityProduced: acc.quantityProduced + qty,
        goodParts: acc.goodParts + good,
        rejectedParts: acc.rejectedParts + Math.max(0, qty - good),
      };
    },
    { quantityProduced: 0, goodParts: 0, rejectedParts: 0 }
  );

  /**
   * Stage 1 - charge the furnace.
   *
   * This is all an operator can know when the metal goes in, so it is all the
   * form asks for. The batch opens as PENDING and is filled in later.
   */
  const handleCreateBatch = async () => {
    if (!formData.furnaceId) {
      setError("Select the furnace this batch was run on");
      return;
    }
    if (furnaceIsFull) {
      setError(
        `${selectedFurnace?.name ?? "That furnace"} already has ${selectedFurnace?.openBatches} batches waiting to be completed`
      );
      return;
    }
    if (ingotChargeTotal <= 0) {
      setError(`Enter the weight of ${selectedGrade.grade} aluminium used`);
      return;
    }
    if (stockKnown && ingotChargeTotal > selectedGradeStock) {
      setError(
        `Only ${formatWeight(selectedGradeStock)} of ${selectedGrade.grade} in stock`
      );
      return;
    }
    for (const form of SCRAP_FORMS) {
      const raw = formData[SCRAP_USED_FIELD[form.form]].trim();
      if (!raw) continue;
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 0) {
        setError(`${form.label} scrap used must be a weight of 0 or more`);
        return;
      }
      const stock =
        stockByType[materialType(form.form, selectedGrade.grade)] ?? 0;
      if (stockKnown && parseWeightInput(raw) > stock) {
        setError(
          `Only ${formatWeight(stock)} of ${selectedGrade.grade} ${form.label.toLowerCase()} scrap in stock`
        );
        return;
      }
    }

    await submitBatch("/api/production", "POST", {
      furnaceId: formData.furnaceId,
      // The batch is charged with one grade; the other two go over as 0
      aluminumUsedLM6:
        formData.ingotGrade === "INGOT_LM6" ? ingotChargeTotal : 0,
      aluminumUsedLM9:
        formData.ingotGrade === "INGOT_LM9" ? ingotChargeTotal : 0,
      aluminumUsedLM25:
        formData.ingotGrade === "INGOT_LM25" ? ingotChargeTotal : 0,
      runnerRaiserScrapUsed: parseWeightInput(formData.runnerRaiserScrapUsed),
      spillageScrapUsed: parseWeightInput(formData.spillageScrapUsed),
      rejectedPartScrapUsed: parseWeightInput(formData.rejectedPartScrapUsed),
    });
  };

  /** Stage 2 - what the assay said. Both parts optional. */
  const handleRecordMelt = async () => {
    if (!editingRecord) return;

    for (const element of LM6_ELEMENTS) {
      const { error: elementError } = checkElementValue(
        element,
        elementValues[element.symbol] ?? ""
      );
      if (elementError) {
        setError(`${element.name} (${element.symbol}): ${elementError.toLowerCase()}`);
        return;
      }
    }

    await submitBatch(`/api/production/${editingRecord.id}`, "PATCH", {
      stage: "melt",
      densityAtmospheric: formData.densityAtmospheric || undefined,
      densityVacuum: formData.densityVacuum || undefined,
      composition: buildCompositionEntries(elementValues),
    });
  };

  /** Stage 3 - count the castings, book the scrap, close the batch. */
  const handleCompleteBatch = async () => {
    if (!editingRecord) return;

    if (partLines.length === 0) {
      setError("Add at least one part to this batch");
      return;
    }
    for (const line of partLines) {
      const qty = parseInt(line.quantityProduced) || 0;
      const good = parseInt(line.goodParts) || 0;
      const part = parts.find((p) => p.id === line.partId);
      if (qty <= 0) {
        setError(`Enter the quantity produced for ${part?.name ?? "each part"}`);
        return;
      }
      if (good > qty) {
        setError(`Good parts cannot exceed quantity produced for ${part?.name ?? "a part"}`);
        return;
      }
    }

    await submitBatch(`/api/production/${editingRecord.id}`, "PATCH", {
      stage: "complete",
      items: partLines.map((line) => ({
        partId: line.partId,
        quantityProduced: parseInt(line.quantityProduced) || 0,
        goodParts: parseInt(line.goodParts) || 0,
      })),
      runnerRaiserScrap: parseWeightInput(formData.runnerRaiserScrap),
      spillageScrap: parseWeightInput(formData.spillageScrap),
      rejectedPartScrap: parseWeightInput(formData.rejectedPartScrap),
      notes: formData.notes,
    });
  };

  /**
   * The shared half of all three stages: send it, fold the returned record
   * back into the list, close the dialog. Stock moves at stage 1 and stage 3,
   * so the lookups are refreshed either way.
   */
  const submitBatch = async (
    url: string,
    method: "POST" | "PATCH",
    payload: Record<string, unknown>
  ) => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (data.success) {
        setBatchModal(null);
        setEditingRecord(null);
        resetForm();

        // The rows are re-read rather than patched in place: saving can move a
        // batch to the OTHER tab - completing one takes it out of In Progress -
        // and the two lists are filtered in the database, so only a fresh query
        // knows which one it now belongs to.
        if (method === "POST") {
          // A new batch is PENDING, so show the list it actually landed in.
          // Changing the tab re-runs the query on its own; it is only when the
          // tab is already right that the refetch has to be asked for.
          setListTab("inProgress");
          if (listTab === "inProgress") await fetchRecords();
        } else {
          await fetchRecords();
        }

        await fetchLookups();
      } else {
        setError(data.error || "Failed to save batch");
      }
    } catch (err) {
      console.error("Error saving batch:", err);
      setError("Failed to save batch");
    } finally {
      setIsLoading(false);
    }
  };

  const openCreate = () => {
    setEditingRecord(null);
    setError("");
    resetForm();
    setBatchModal("create");
  };

  const closeBatchModal = () => {
    setBatchModal(null);
    setEditingRecord(null);
    resetForm();
  };

  /**
   * Opens a later stage on an existing batch, pre-filled with what it holds.
   *
   * An amendment fills in EVERY field, not just the stage's own - an admin
   * correcting one figure needs to see the rest of the batch to know whether
   * it is the figure that is wrong.
   */
  const openStage = (
    record: ProductionRecord,
    stage: "melt" | "complete" | "amend"
  ) => {
    setEditingRecord(record);
    setError("");

    const wantsMelt = stage === "melt" || stage === "amend";
    const wantsOutput = stage === "complete" || stage === "amend";
    const wantsCharge = stage === "amend";

    if (wantsMelt) {
      // Stored values carry their unit ("12%"); the inputs are numeric, so
      // they come back through the boundary that strips it
      const values = compositionToInputs(record.composition);
      setElementValues(values);
      // Al was typed by hand if it is on the record, so do not overwrite it
      // with the computed balance
      setAlIsAuto(!values.Al);
    } else {
      setElementValues({});
      setAlIsAuto(true);
    }

    if (wantsOutput) {
      setPartLines(
        record.items.map((item) => ({
          partId: item.partId,
          quantityProduced: String(item.quantityProduced),
          goodParts: String(item.goodParts),
        }))
      );
    } else {
      setPartLines([]);
    }

    // Weights are stored in grams and typed in kg, so each one goes back
    // through the same boundary it came in by
    const kg = (grams: number) => (grams ? weightToInput(grams) : "");

    setFormData((f) => ({
      ...f,
      ...(wantsCharge
        ? {
            furnaceId: record.furnace?.id ?? "",
            ingotGrade: record.ingotGrade,
            aluminumUsed: kg(record.aluminumUsed),
            runnerRaiserScrapUsed: kg(record.runnerRaiserScrapUsed),
            spillageScrapUsed: kg(record.spillageScrapUsed),
            rejectedPartScrapUsed: kg(record.rejectedPartScrapUsed),
          }
        : {}),
      ...(wantsMelt
        ? {
            densityAtmospheric: record.densityAtmospheric?.toString() ?? "",
            densityVacuum: record.densityVacuum?.toString() ?? "",
          }
        : {}),
      ...(wantsOutput
        ? {
            runnerRaiserScrap: kg(record.runnerRaiserScrap),
            spillageScrap: kg(record.spillageScrap),
            rejectedPartScrap: kg(record.rejectedPartScrap),
            notes: record.notes ?? "",
          }
        : {}),
    }));

    setBatchModal(stage);
  };

  /** Admin correction: the whole batch, saved in one request. */
  const handleAmendBatch = async () => {
    if (!editingRecord) return;

    if (partLines.length === 0) {
      setError("A batch needs at least one part");
      return;
    }
    for (const line of partLines) {
      const qty = parseInt(line.quantityProduced) || 0;
      const good = parseInt(line.goodParts) || 0;
      const part = parts.find((p) => p.id === line.partId);
      if (qty <= 0) {
        setError(`Enter the quantity produced for ${part?.name ?? "each part"}`);
        return;
      }
      if (good > qty) {
        setError(`Good parts cannot exceed quantity produced for ${part?.name ?? "a part"}`);
        return;
      }
    }
    if (ingotChargeTotal <= 0) {
      setError("Enter the weight of aluminium used");
      return;
    }
    for (const element of LM6_ELEMENTS) {
      const { error: elementError } = checkElementValue(
        element,
        elementValues[element.symbol] ?? ""
      );
      if (elementError) {
        setError(`${element.name} (${element.symbol}): ${elementError.toLowerCase()}`);
        return;
      }
    }

    await submitBatch(`/api/production/${editingRecord.id}`, "PATCH", {
      stage: "amend",
      furnaceId: formData.furnaceId,
      aluminumUsedLM6:
        formData.ingotGrade === "INGOT_LM6" ? ingotChargeTotal : 0,
      aluminumUsedLM9:
        formData.ingotGrade === "INGOT_LM9" ? ingotChargeTotal : 0,
      aluminumUsedLM25:
        formData.ingotGrade === "INGOT_LM25" ? ingotChargeTotal : 0,
      runnerRaiserScrapUsed: parseWeightInput(formData.runnerRaiserScrapUsed),
      spillageScrapUsed: parseWeightInput(formData.spillageScrapUsed),
      rejectedPartScrapUsed: parseWeightInput(formData.rejectedPartScrapUsed),
      densityAtmospheric: formData.densityAtmospheric || undefined,
      densityVacuum: formData.densityVacuum || undefined,
      composition: buildCompositionEntries(elementValues),
      items: partLines.map((line) => ({
        partId: line.partId,
        quantityProduced: parseInt(line.quantityProduced) || 0,
        goodParts: parseInt(line.goodParts) || 0,
      })),
      runnerRaiserScrap: parseWeightInput(formData.runnerRaiserScrap),
      spillageScrap: parseWeightInput(formData.spillageScrap),
      rejectedPartScrap: parseWeightInput(formData.rejectedPartScrap),
      notes: formData.notes,
    });
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
            Production Management
          </h1>
          <p className="text-[var(--muted-foreground)]">
            Track manufacturing batches and scrap generation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            isLoading={isExporting}
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button onClick={() => openCreate()}>
            <Plus className="h-4 w-4 mr-2" />
            New Production Batch
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Today's Production"
          value={`${todayProduction} parts`}
          icon={Factory}
        />
        <StatCard
          title="Average Efficiency"
          value={`${avgEfficiency.toFixed(1)}%`}
          icon={TrendingUp}
        />
        <StatCard
          title="Total Scrap Generated"
          value={formatWeight(totalScrap)}
          icon={Recycle}
          description="All time"
        />
        <StatCard
          title="Total Batches"
          value={records.length.toString()}
          icon={Package}
          description="All time"
        />
      </div>

      {/* Search and Filter */}
      <Card>
        <CardContent className="p-4">
          {/* Two lists, because a batch on the floor and a batch in the record
              book are different things. In Progress is where the day's work
              sits waiting to be filled in. */}
          <div className="mb-4 inline-flex gap-1 rounded-lg bg-[var(--muted)] p-1">
            {(
              [
                { key: "completed", label: "Completed Batches", icon: CheckCircle2 },
                { key: "inProgress", label: "In Progress", icon: Clock },
              ] as const
            ).map((tab) => {
              const active = listTab === tab.key;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setListTab(tab.key);
                    setPage(1);
                  }}
                  className={`cursor-pointer flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Search by batch number or part name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              variant={showFilters ? "default" : "outline"}
              onClick={() => setShowFilters((open) => !open)}
            >
              <Filter className="h-4 w-4 mr-2" />
              Filter
              {activeFilterCount > 0 && (
                <span className="ml-2 rounded-full bg-[var(--background)] px-1.5 text-xs font-semibold text-[var(--primary)]">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>

          {/* Filter panel */}
          {showFilters && (
            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-[var(--border)] pt-4 sm:grid-cols-4">
              <Select
                label="Furnace"
                options={[
                  { value: "ALL", label: "All Furnaces" },
                  ...furnaceOptions,
                ]}
                value={filterFurnaceId}
                onChange={(value) => {
                  setFilterFurnaceId(value);
                  setPage(1);
                }}
              />
              <Input
                label="From Date"
                type="date"
                value={filterFrom}
                onChange={(e) => {
                  setFilterFrom(e.target.value);
                  setPage(1);
                }}
              />
              <Input
                label="To Date"
                type="date"
                value={filterTo}
                onChange={(e) => {
                  setFilterTo(e.target.value);
                  setPage(1);
                }}
              />
              <div className="flex items-end">
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={activeFilterCount === 0}
                  onClick={() => {
                    setFilterFurnaceId("ALL");
                    setFilterFrom("");
                    setFilterTo("");
                    setPage(1);
                  }}
                >
                  Clear Filters
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Production Records Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Factory className="h-5 w-5 text-[var(--primary)]" />
            Production Records
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredRecords.length === 0 ? (
            <EmptyState
              icon={Factory}
              title={
                listTab === "completed"
                  ? "No completed batches"
                  : "Nothing in progress"
              }
              description={
                listTab === "completed"
                  ? "Batches appear here once their castings have been counted."
                  : "Charge a furnace to open a batch. It stays here until you complete it."
              }
              action={
                <Button onClick={() => openCreate()}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Production Batch
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Batch Number
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Parts
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Furnace
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Date
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      {listTab === "completed" ? "Efficiency" : "Stage"}
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((record) => (
                    <tr
                      key={record.id}
                      className="border-b border-[var(--border)] hover:bg-[var(--muted)]"
                    >
                      <td className="py-3 px-4">
                        <span className="font-mono text-sm bg-[var(--muted)] px-2 py-1 rounded">
                          {record.batchNumber}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {/* First part by name; the rest collapse into a +n badge */}
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {record.items[0]?.part.name ?? "-"}
                          </span>
                          {record.items.length > 1 && (
                            <span
                              className="shrink-0 rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs font-medium text-[var(--muted-foreground)]"
                              title={record.items
                                .slice(1)
                                .map((i) => i.part.name)
                                .join(", ")}
                            >
                              +{record.items.length - 1}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {record.furnace ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--primary-dark)]">
                            <Flame className="h-3 w-3" />
                            {record.furnace.name}
                          </span>
                        ) : (
                          <span className="text-sm text-[var(--muted-foreground)]">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-[var(--muted-foreground)]">
                        {formatDate(new Date(record.date))}
                      </td>
                      <td className="py-3 px-4">
                        {record.status === "COMPLETED" ? (
                          <Badge
                            variant={
                              record.efficiency >= 90
                                ? "success"
                                : record.efficiency >= 80
                                ? "warning"
                                : "error"
                            }
                          >
                            {record.efficiency.toFixed(1)}%
                          </Badge>
                        ) : (
                          <span
                            title={STATUS_META[record.status].hint}
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_META[record.status].className}`}
                          >
                            {STATUS_META[record.status].label}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="View batch details"
                          className="-ml-3"
                          onClick={() => {
                            setSelectedRecord(record);
                            setIsViewModalOpen(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {/* An open batch is carried forward stage by stage.
                            A completed one is not a stage any more, so an
                            admin gets a single Update opening the whole batch. */}
                        {record.status === "COMPLETED"
                          ? isAdmin && (
                              <Button
                                variant="outline"
                                size="sm"
                                title="Open this batch and correct any of it"
                                onClick={() => openStage(record, "amend")}
                              >
                                Update
                              </Button>
                            )
                          : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={
                                  record.status === "PENDING"
                                    ? "Add the melt reading"
                                    : "Edit the melt reading"
                                }
                                onClick={() => openStage(record, "melt")}
                              >
                                <FlaskRound className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                title="Count the castings and close this batch"
                                onClick={() => openStage(record, "complete")}
                              >
                                Complete
                              </Button>
                            </>
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

      {/* New Production Batch Modal */}
      <Modal
        isOpen={batchModal !== null}
        onClose={closeBatchModal}
        title={MODAL_COPY[batchModal ?? "create"].title}
        description={
          editingRecord
            ? `${editingRecord.batchNumber} - ${MODAL_COPY[batchModal ?? "create"].description}`
            : MODAL_COPY[batchModal ?? "create"].description
        }
        size="xl"
      >
        <div className="space-y-6">
          {/* Parts in this batch - only at completion, when they are counted */}
          {showOutput && (
          <div className="rounded-lg border border-[var(--primary)]/20 bg-[var(--accent)] p-4">
            <h4 className="mb-3 font-medium text-[var(--foreground)]">
              Parts in this Batch
            </h4>

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Select
                  label="Add a part"
                  options={availablePartOptions}
                  value={partToAdd}
                  onChange={addPartLine}
                  placeholder={
                    availablePartOptions.length === 0
                      ? "All parts added"
                      : "Choose a part to add"
                  }
                  className="h-12"
                />
              </div>
            </div>

            {partLines.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                No parts added yet. Add at least one part to record this batch.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {partLines.map((line) => {
                  const part = parts.find((p) => p.id === line.partId);
                  const qty = parseInt(line.quantityProduced) || 0;
                  const good = parseInt(line.goodParts) || 0;
                  const rejected = Math.max(0, qty - good);
                  const invalid = good > qty;

                  return (
                    <div
                      key={line.partId}
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="font-mono text-xs bg-[var(--muted)] px-1.5 py-0.5 rounded">
                            {part?.partCode}
                          </span>
                          <span className="truncate font-medium">{part?.name}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removePartLine(line.partId)}
                          title="Remove this part"
                          className="shrink-0 cursor-pointer rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-100 hover:text-red-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-3">
                        <Input
                          label="Produced"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={line.quantityProduced}
                          onChange={(e) =>
                            updatePartLine(line.partId, {
                              quantityProduced: e.target.value,
                            })
                          }
                        />
                        <Input
                          label="Good"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={line.goodParts}
                          error={invalid ? "Exceeds produced" : undefined}
                          onChange={(e) =>
                            updatePartLine(line.partId, { goodParts: e.target.value })
                          }
                        />
                        <Input
                          label="Rejected"
                          type="number"
                          value={String(rejected)}
                          disabled
                        />
                      </div>
                    </div>
                  );
                })}

                {/* Batch totals */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--background)] px-3 py-2 text-sm">
                  <span className="font-medium">Batch Total</span>
                  <span className="flex gap-4 text-[var(--muted-foreground)]">
                    <span>
                      Produced:{" "}
                      <span className="font-semibold text-[var(--foreground)]">
                        {batchTotals.quantityProduced}
                      </span>
                    </span>
                    <span>
                      Good:{" "}
                      <span className="font-semibold text-green-700">
                        {batchTotals.goodParts}
                      </span>
                    </span>
                    <span>
                      Rejected:{" "}
                      <span className="font-semibold text-red-600">
                        {batchTotals.rejectedParts}
                      </span>
                    </span>
                  </span>
                </div>
              </div>
            )}
          </div>
          )}

          {/* Furnace + input material - the charge, recorded when it goes in */}
          {showCharge && (
          <>
          <div>
            <h4 className="font-medium text-[var(--foreground)] mb-3">
              Furnace &amp; Input Material
            </h4>
            <Select
              label="Furnace (Bhatti)"
              options={furnaceOptions}
              value={formData.furnaceId}
              onChange={(value) => setFormData({ ...formData, furnaceId: value })}
              placeholder={
                furnaceOptions.length === 0
                  ? "No furnaces configured - add them in Settings"
                  : "Select the furnace used"
              }
              className="h-12"
            />

            {/* Say why a furnace is unavailable, right where it is chosen -
                and which batches are in the way */}
            {selectedFurnace && !isAmending && (
              furnaceIsFull ? (
                <p className="mt-2 flex items-start gap-2 rounded-lg border border-[var(--error)]/30 bg-red-50 p-3 text-sm text-[var(--error)]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    You cannot add a batch on {selectedFurnace.name} &mdash;{" "}
                    {selectedFurnace.openBatches} batches are already pending or
                    updated. Complete those first, or pick another furnace.
                  </span>
                </p>
              ) : selectedFurnace.openBatches > 0 ? (
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                  {selectedFurnace.openBatches} of{" "}
                  {MAX_OPEN_BATCHES_PER_FURNACE} batches on this furnace are
                  still open.
                </p>
              ) : null
            )}
          </div>

          {/* Aluminium charged. One heat runs on one alloy, so the grade is a
              single choice and the weight is entered against it. */}
          <div>
            <h4 className="mb-1 flex items-center gap-2 font-medium text-[var(--foreground)]">
              <Package className="h-4 w-4 text-[var(--primary)]" />
              Aluminium Used ({WEIGHT_UNIT})
            </h4>
            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              Pick the grade this heat was charged with, then enter the weight
              taken from it.
            </p>

            {/* Grade tabs - one at a time */}
            <div
              role="tablist"
              aria-label="Aluminium grade"
              className="mb-4 inline-flex gap-1 rounded-lg bg-[var(--muted)] p-1"
            >
              {INGOT_GRADES.map((ingot) => {
                const active = formData.ingotGrade === ingot.type;
                return (
                  <button
                    key={ingot.type}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() =>
                      // Scrap weights are cleared with the grade: they were
                      // entered against the old alloy's stock, and silently
                      // re-pointing them at another grade would move metal the
                      // operator never chose.
                      setFormData({
                        ...formData,
                        ingotGrade: ingot.type,
                        runnerRaiserScrapUsed: "",
                        spillageScrapUsed: "",
                        rejectedPartScrapUsed: "",
                      })
                    }
                    className={`cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${ingot.dotClass}`} />
                      {ingot.grade}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              {selectedGrade.description} ·{" "}
              <span className="font-medium text-[var(--foreground)]">
                {formatWeight(selectedGradeStock)}
              </span>{" "}
              in stock
            </p>

            <Input
              label={`Ingot Used (${WEIGHT_UNIT})`}
              type="number"
              min="0"
              step="any"
              placeholder="Weight in kg"
              value={formData.aluminumUsed}
              error={
                stockKnown && ingotChargeTotal > selectedGradeStock
                  ? `Only ${formatWeight(selectedGradeStock)} in stock`
                  : undefined
              }
              helperText={
                stockKnown && ingotChargeTotal > selectedGradeStock
                  ? undefined
                  : "Weight of ingot charged into this heat"
              }
              onChange={(e) =>
                setFormData({ ...formData, aluminumUsed: e.target.value })
              }
              className="h-12"
            />
          </div>

          {/* Scrap charged back into the melt - optional, and restricted to
              the batch's own alloy. Re-melting LM9 runners into an LM6 heat
              would put the melt out of spec, so only this grade's scrap is
              offered and only its stock is shown. */}
          <div>
            <h4 className="mb-1 flex items-center gap-2 font-medium text-[var(--foreground)]">
              <Recycle className="h-4 w-4 text-[var(--primary)]" />
              Scrap Used ({WEIGHT_UNIT})
            </h4>
            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              Optional. Scrap re-melted into this batch, from the grade chosen
              above - a heat can only take back its own alloy. It is deducted
              from scrap stock and counted as part of the charge.
            </p>
            <div className="grid grid-cols-3 gap-4">
              {SCRAP_FORMS.map((form) => {
                const field = SCRAP_USED_FIELD[form.form];
                const stockType = materialType(form.form, selectedGrade.grade);
                const stock = stockByType[stockType] ?? 0;
                const entered = parseWeightInput(formData[field]);
                const short = stockKnown && entered > stock;

                return (
                  <Input
                    key={form.form}
                    label={form.label}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Weight in kg"
                    value={formData[field]}
                    error={short ? `Only ${formatWeight(stock)} in stock` : undefined}
                    helperText={
                      short
                        ? undefined
                        : stockKnown
                          ? `${formatWeight(stock)} in stock`
                          : undefined
                    }
                    onChange={(e) =>
                      setFormData({ ...formData, [field]: e.target.value })
                    }
                    className="h-12"
                  />
                );
              })}
            </div>

            {totalCharge > 0 && (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                Total charge:{" "}
                <span className="font-medium text-[var(--foreground)]">
                  {formatWeight(totalCharge)}
                </span>
                {scrapUsedTotal > 0 && (
                  <> &middot; {formatWeight(scrapUsedTotal)} of it re-melted scrap</>
                )}
              </p>
            )}
          </div>
          </>
          )}

          {/* LM6 chemical composition - fixed, named element fields */}
          {showMelt && (
          <>
          <div>
            <h4 className="mb-1 flex items-center gap-2 font-medium text-[var(--foreground)]">
              <FlaskConical className="h-4 w-4 text-[var(--primary)]" />
              Chemical Composition &mdash; LM6
            </h4>
            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              Optional. Fill in only the elements you measured &mdash; blanks
              are left out of the record, not saved as zero. Readings outside
              the LM6 limit are flagged but still saved.
            </p>

            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {LM6_ELEMENTS.map((element) => {
                const raw = elementValues[element.symbol] ?? "";

                if (element.isRemainder) {
                  const { entered, total, overflow } =
                    aluminiumBalance(elementValues);

                  return (
                    <div key={element.symbol}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label
                          htmlFor="element-Al"
                          className="text-sm font-medium text-[var(--foreground)]"
                        >
                          {element.name} ({element.symbol})
                        </label>
                        {alIsAuto ? (
                          <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs font-medium text-[var(--primary)]">
                            Auto
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={restoreAutoAluminium}
                            className="cursor-pointer text-xs font-medium text-[var(--primary)] hover:underline"
                          >
                            Use balance
                          </button>
                        )}
                      </div>
                      <Input
                        id="element-Al"
                        type="number"
                        step="0.001"
                        min="0"
                        max="100"
                        inputMode="decimal"
                        placeholder={overflow ? "Check readings" : "%"}
                        value={raw}
                        error={
                          overflow
                            ? `Other elements already total ${total}%`
                            : checkElementValue(element, raw).error ?? undefined
                        }
                        helperText={
                          overflow
                            ? undefined
                            : alIsAuto
                              ? entered === 0
                                ? "Balance of the heat, filled in for you"
                                : `Balance of ${total}% entered so far`
                              : "Entered manually"
                        }
                        onChange={(e) => {
                          setAlIsAuto(false);
                          setElementValue("Al", e.target.value);
                        }}
                      />
                    </div>
                  );
                }

                const { error, warning } = checkElementValue(element, raw);

                return (
                  <div key={element.symbol}>
                    <Input
                      label={`${element.name} (${element.symbol})`}
                      type="number"
                      step="0.001"
                      min="0"
                      max="100"
                      inputMode="decimal"
                      placeholder="%"
                      value={raw}
                      error={error ?? undefined}
                      // The warning names the limit it broke, so it replaces
                      // the spec line rather than stacking under it - that
                      // keeps every cell one line tall and the grid aligned.
                      helperText={warning ? undefined : element.limit}
                      className={
                        !error && warning
                          ? "border-amber-500 focus:ring-amber-500"
                          : undefined
                      }
                      onChange={(e) =>
                        setElementValue(element.symbol, e.target.value)
                      }
                    />
                    {!error && warning && (
                      <p className="mt-1.5 text-sm text-amber-600">{warning}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Melt quality - Reduced Pressure Test, same stage as the assay */}
          <div>
            <h4 className="mb-1 flex items-center gap-2 font-medium text-[var(--foreground)]">
              <FlaskConical className="h-4 w-4 text-[var(--primary)]" />
              Melt Quality &ndash; Density Index
            </h4>
            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              Optional. Enter both sample densities in the same unit and the
              Density Index is calculated for you.
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                label="Atmospheric Density (ρA)"
                type="number"
                step="0.001"
                min="0"
                placeholder="e.g. 2.650"
                value={formData.densityAtmospheric}
                onChange={(e) =>
                  setFormData({ ...formData, densityAtmospheric: e.target.value })
                }
              />
              <Input
                label="Vacuum Density (ρB)"
                type="number"
                step="0.001"
                min="0"
                placeholder="e.g. 2.540"
                value={formData.densityVacuum}
                onChange={(e) =>
                  setFormData({ ...formData, densityVacuum: e.target.value })
                }
                error={densityPairError ?? undefined}
              />

              {/* Read-only computed result */}
              <div>
                <span className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                  Density Index
                </span>
                <div className="flex h-10 items-center justify-between rounded-md border border-[var(--border)] bg-[var(--muted)] px-3">
                  <span className="font-semibold text-[var(--primary)]">
                    {previewDensityIndex !== null && !densityPairError
                      ? formatDensityIndex(previewDensityIndex)
                      : "-"}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    auto
                  </span>
                </div>
              </div>
            </div>

            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              DI = (ρA &minus; ρB) / ρA × 100. Lower is a cleaner, better degassed
              melt.
            </p>
          </div>
          </>
          )}

          {/* Scrap generated - only known once the castings are off the line */}
          {showOutput && (
          <>
          <div>
            <h4 className="font-medium text-[var(--foreground)] mb-3 flex items-center gap-2">
              <Recycle className="h-4 w-4 text-[var(--primary)]" />
              Scrap Generated ({WEIGHT_UNIT})
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <Input
                label="Runner & Raiser"
                type="number"
                min="0"
                step="any"
                placeholder="Weight in kg"
                value={formData.runnerRaiserScrap}
                onChange={(e) =>
                  setFormData({ ...formData, runnerRaiserScrap: e.target.value })
                }
                className="h-12"
              />
              <Input
                label="Spillage"
                type="number"
                min="0"
                step="any"
                placeholder="Weight in kg"
                value={formData.spillageScrap}
                onChange={(e) =>
                  setFormData({ ...formData, spillageScrap: e.target.value })
                }
                className="h-12"
              />
              <Input
                label="Rejected Part Scrap"
                type="number"
                min="0"
                step="any"
                placeholder="Weight in kg"
                value={formData.rejectedPartScrap}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    rejectedPartScrap: e.target.value,
                  })
                }
                className="h-12"
              />
            </div>
          </div>

          {/* Notes - written up with the rest of the closing paperwork */}
          <Textarea
            label="Notes (Optional)"
            placeholder="Add any notes about this production batch..."
            value={formData.notes}
            onChange={(e) =>
              setFormData({ ...formData, notes: e.target.value })
            }
            className="min-h-[80px]"
          />
          </>
          )}

          {/* What this stage will do to stock, said plainly */}
          {batchModal !== "melt" && (
            <div className="p-4 rounded-lg bg-[var(--info-light)] border border-[var(--info)]/20">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-[var(--info)] mt-0.5" />
                <div className="text-sm text-[var(--info)]">
                  <p className="font-medium">Stock movement</p>
                  <p>
                    {batchModal === "create"
                      ? "The metal charged is deducted from stock now - it is in the furnace. The batch stays In Progress until you add the melt reading and the parts."
                      : isAmending
                      ? "Every stock line moves by the DIFFERENCE between what this batch was recorded as before and what you save now - including a changed grade. Nothing is booked twice."
                      : "The scrap generated is added to this grade's stock and the batch is closed."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <ModalFooter className="justify-between">
          {/* Left: validation message, or a summary of what will be saved */}
          <div className="min-w-0 flex-1 text-sm">
            {error ? (
              <span className="flex items-center gap-2 text-[var(--error)]">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="truncate">{error}</span>
              </span>
            ) : batchModal === "amend" ? (
              <span className="text-[var(--muted-foreground)]">
                {partLines.length} part{partLines.length === 1 ? "" : "s"}
                {" \u00b7 "}
                {formatWeight(totalCharge)} charged
                {" \u00b7 "}
                stock moves by the difference
              </span>
            ) : batchModal === "create" && furnaceIsFull ? (
              <span className="flex items-center gap-2 text-[var(--error)]">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {selectedFurnace?.name} has {selectedFurnace?.openBatches}{" "}
                batches to complete first
              </span>
            ) : batchModal === "create" ? (
              <span className="text-[var(--muted-foreground)]">
                {ingotChargeTotal > 0
                  ? `Charging ${formatWeight(totalCharge)} of ${selectedGrade.grade}`
                  : "Enter the metal charged into the furnace"}
              </span>
            ) : batchModal === "melt" ? (
              <span className="text-[var(--muted-foreground)]">
                {enteredElementCount > 0
                  ? `${enteredElementCount} element${enteredElementCount > 1 ? "s" : ""} recorded`
                  : "Both parts are optional - save what you measured"}
              </span>
            ) : partLines.length > 0 ? (
              <span className="text-[var(--muted-foreground)]">
                {partLines.length} part{partLines.length > 1 ? "s" : ""}
                {batchTotals.quantityProduced > 0 && (
                  <> &middot; {batchTotals.quantityProduced} produced</>
                )}
              </span>
            ) : (
              <span className="text-[var(--muted-foreground)]">
                Add at least one part
              </span>
            )}
          </div>

          {/* Right: actions */}
          <div className="flex shrink-0 items-center gap-3">
            <Button variant="secondary" onClick={closeBatchModal}>
              Cancel
            </Button>
            <Button
              onClick={
                batchModal === "create"
                  ? handleCreateBatch
                  : batchModal === "melt"
                  ? handleRecordMelt
                  : batchModal === "amend"
                  ? handleAmendBatch
                  : handleCompleteBatch
              }
              isLoading={isLoading}
              disabled={batchModal === "create" && furnaceIsFull}
            >
              {batchModal === "create" ? (
                <Plus className="h-4 w-4 mr-2" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              {MODAL_COPY[batchModal ?? "create"].action}
            </Button>
          </div>
        </ModalFooter>
      </Modal>

      {/* View Production Details Modal */}
      <Modal
        isOpen={isViewModalOpen}
        onClose={() => {
          setIsViewModalOpen(false);
          setSelectedRecord(null);
        }}
        title="Production Batch Details"
        size="lg"
      >
        {selectedRecord && (() => {
          // Everything charged in, everything that came back out. Derived here
          // so the panel can show the balance rather than a pile of figures.
          const charge =
            selectedRecord.aluminumUsed + selectedRecord.totalScrapUsed;
          const outputWeight = selectedRecord.items.reduce(
            (sum, i) => sum + i.goodParts * (i.part.weightPerPiece ?? 0),
            0
          );
          const accounted = outputWeight + selectedRecord.totalScrap;
          const meltLoss = charge - accounted;
          // Output exceeding the charge is impossible, but a rounding-level gap
          // is not worth shouting about - only a material one is called out.
          const impossibleBalance = meltLoss < 0 && Math.abs(meltLoss) > charge * 0.02;
          const hasRemelt = selectedRecord.totalScrapUsed > 0;
          // Only the grades this heat actually drew on
          const gradeCharge = [
            { grade: "LM6", amount: selectedRecord.aluminumUsedLM6 },
            { grade: "LM9", amount: selectedRecord.aluminumUsedLM9 },
            { grade: "LM25", amount: selectedRecord.aluminumUsedLM25 },
          ].filter((g) => g.amount > 0);
          const entries = readComposition(selectedRecord.composition);
          const outOfSpec = entries.filter(
            (e) => compositionSpecStatus(e.key, e.value) === "out"
          ).length;

          // Scrap takes the grade of the heat it came off, so the table names
          // the alloy rather than leaving the stock line ambiguous
          const batchGrade = gradeName(selectedRecord.ingotGrade);
          const scrapRows = [
            {
              label: "Runner & Raiser",
              used: selectedRecord.runnerRaiserScrapUsed,
              made: selectedRecord.runnerRaiserScrap,
            },
            {
              label: "Spillage",
              used: selectedRecord.spillageScrapUsed,
              made: selectedRecord.spillageScrap,
            },
            {
              label: "Rejected Part",
              used: selectedRecord.rejectedPartScrapUsed,
              made: selectedRecord.rejectedPartScrap,
            },
          ];

          return (
            <div className="space-y-6">
              {/* Identity - batch, when, where, who, and the headline yield */}
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-[var(--muted)] p-4">
                <div className="min-w-0">
                  <p className="font-mono text-lg font-bold text-[var(--foreground)]">
                    {selectedRecord.batchNumber}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {formatDateTime(new Date(selectedRecord.date))}
                    {" · "}
                    {selectedRecord.furnace?.name ?? "No furnace recorded"}
                    {" · "}
                    {selectedRecord.user.name}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge
                    variant={
                      selectedRecord.efficiency >= 90
                        ? "success"
                        : selectedRecord.efficiency >= 80
                          ? "warning"
                          : "error"
                    }
                    className="px-4 py-2 text-lg"
                  >
                    {selectedRecord.efficiency.toFixed(1)}%
                  </Badge>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    Yield
                  </p>
                </div>
              </div>

              {/* Metal balance - what went in against what came back */}
              <section>
                <h4 className="mb-3 font-medium text-[var(--foreground)]">
                  Metal Balance
                </h4>
                <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                  {gradeCharge.length > 1 ? (
                    gradeCharge.map((g) => (
                      <div
                        key={g.grade}
                        className="flex items-center justify-between px-4 py-2.5 text-sm"
                      >
                        <span className="text-[var(--muted-foreground)]">
                          {g.grade} ingot charged
                        </span>
                        <span className="font-medium">
                          {formatWeight(g.amount)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-[var(--muted-foreground)]">
                        {gradeCharge[0]
                          ? `${gradeCharge[0].grade} ingot charged`
                          : "Ingot charged"}
                      </span>
                      <span className="font-medium">
                        {formatWeight(selectedRecord.aluminumUsed)}
                      </span>
                    </div>
                  )}
                  {hasRemelt && (
                    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-[var(--muted-foreground)]">
                        Scrap re-melted
                      </span>
                      <span className="font-medium">
                        {formatWeight(selectedRecord.totalScrapUsed)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-y border-[var(--border)] bg-[var(--muted)] px-4 py-2.5 text-sm">
                    <span className="font-medium text-[var(--foreground)]">
                      Total charge
                    </span>
                    <span className="font-semibold">{formatWeight(charge)}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-[var(--muted-foreground)]">
                      Good castings out
                    </span>
                    <span className="font-medium">
                      {formatWeight(outputWeight)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-[var(--muted-foreground)]">
                      Scrap generated
                    </span>
                    <span className="font-medium">
                      {formatWeight(selectedRecord.totalScrap)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5 text-sm">
                    <span className="text-[var(--muted-foreground)]">
                      {meltLoss < 0 ? "Unaccounted (over)" : "Melt loss"}
                    </span>
                    <span
                      className={
                        meltLoss < 0
                          ? "font-medium text-amber-600"
                          : "font-medium"
                      }
                    >
                      {formatWeight(Math.abs(meltLoss))}
                    </span>
                  </div>
                </div>
                {impossibleBalance && (
                  <p className="mt-2 text-xs text-amber-600">
                    Recorded output exceeds the charge &mdash; check the weights
                    on this batch.
                  </p>
                )}
              </section>

              {/* Parts made */}
              <section>
                <h4 className="mb-3 font-medium text-[var(--foreground)]">
                  Parts ({selectedRecord.items.length})
                </h4>
                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                      <tr>
                        <th className="px-4 py-2 font-medium">Part</th>
                        <th className="px-4 py-2 text-right font-medium">Produced</th>
                        <th className="px-4 py-2 text-right font-medium">Good</th>
                        <th className="px-4 py-2 text-right font-medium">Rejected</th>
                        <th className="px-4 py-2 text-right font-medium">Weight Out</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRecord.items.map((item) => (
                        <tr
                          key={item.id}
                          className="border-t border-[var(--border)]"
                        >
                          <td className="px-4 py-2.5">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-xs">
                                {item.part.partCode}
                              </span>
                              <span className="truncate font-medium">
                                {item.part.name}
                              </span>
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {item.quantityProduced}
                          </td>
                          <td className="px-4 py-2.5 text-right text-green-700">
                            {item.goodParts}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right ${
                              item.rejectedParts > 0
                                ? "text-red-600"
                                : "text-[var(--muted-foreground)]"
                            }`}
                          >
                            {item.rejectedParts}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {formatWeight(
                              item.goodParts * (item.part.weightPerPiece ?? 0)
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {selectedRecord.items.length > 1 && (
                      <tfoot className="border-t border-[var(--border)] bg-[var(--muted)] font-medium">
                        <tr>
                          <td className="px-4 py-2.5">Total</td>
                          <td className="px-4 py-2.5 text-right">
                            {selectedRecord.quantityProduced}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {selectedRecord.goodParts}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {selectedRecord.rejectedParts}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {formatWeight(outputWeight)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </section>

              {/* Scrap, per type - re-melted in and generated out side by side */}
              <section>
                <h4 className="mb-3 font-medium text-[var(--foreground)]">
                  Scrap
                </h4>
                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                      <tr>
                        <th className="px-4 py-2 font-medium">
                          {batchGrade} Scrap
                        </th>
                        {hasRemelt && (
                          <th className="px-4 py-2 text-right font-medium">
                            Re-melted
                          </th>
                        )}
                        <th className="px-4 py-2 text-right font-medium">
                          Generated
                        </th>
                        {hasRemelt && (
                          <th className="px-4 py-2 text-right font-medium">
                            Net to Stock
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {scrapRows.map((row) => {
                        const net = row.made - row.used;
                        return (
                          <tr
                            key={row.label}
                            className="border-t border-[var(--border)]"
                          >
                            <td className="px-4 py-2.5">{row.label}</td>
                            {hasRemelt && (
                              <td className="px-4 py-2.5 text-right text-[var(--muted-foreground)]">
                                {row.used > 0 ? formatWeight(row.used) : "-"}
                              </td>
                            )}
                            <td className="px-4 py-2.5 text-right">
                              {formatWeight(row.made)}
                            </td>
                            {hasRemelt && (
                              <td
                                className={`px-4 py-2.5 text-right font-medium ${
                                  net < 0 ? "text-amber-600" : ""
                                }`}
                              >
                                {net < 0 ? "-" : "+"}
                                {formatWeight(Math.abs(net))}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t border-[var(--border)] bg-[var(--muted)] font-medium">
                      <tr>
                        <td className="px-4 py-2.5">Total</td>
                        {hasRemelt && (
                          <td className="px-4 py-2.5 text-right">
                            {formatWeight(selectedRecord.totalScrapUsed)}
                          </td>
                        )}
                        <td className="px-4 py-2.5 text-right">
                          {formatWeight(selectedRecord.totalScrap)}
                        </td>
                        {hasRemelt && (
                          <td className="px-4 py-2.5 text-right">
                            {selectedRecord.totalScrap -
                              selectedRecord.totalScrapUsed <
                            0
                              ? "-"
                              : "+"}
                            {formatWeight(
                              Math.abs(
                                selectedRecord.totalScrap -
                                  selectedRecord.totalScrapUsed
                              )
                            )}
                          </td>
                        )}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>

              {/* Melt quality and composition, only when they were recorded */}
              {(selectedRecord.densityIndex != null || entries.length > 0) && (
                <section>
                  <h4 className="mb-3 font-medium text-[var(--foreground)]">
                    Melt Quality
                  </h4>

                  {selectedRecord.densityIndex != null && (
                    <div className="mb-3 flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3">
                      <div>
                        <p className="text-sm text-[var(--muted-foreground)]">
                          Density Index
                        </p>
                        {selectedRecord.densityAtmospheric != null &&
                          selectedRecord.densityVacuum != null && (
                            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                              &rho;A {selectedRecord.densityAtmospheric} &middot;
                              &rho;B {selectedRecord.densityVacuum}
                            </p>
                          )}
                      </div>
                      <p className="text-lg font-semibold">
                        {formatDensityIndex(selectedRecord.densityIndex)}
                      </p>
                    </div>
                  )}

                  {entries.length > 0 && (
                    <>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {entries.map((entry) => {
                          const status = compositionSpecStatus(
                            entry.key,
                            entry.value
                          );
                          return (
                            <div
                              key={entry.key}
                              className={`flex items-baseline justify-between gap-2 rounded-lg border px-3 py-2 ${
                                status === "out"
                                  ? "border-amber-500 bg-amber-50"
                                  : "border-[var(--border)]"
                              }`}
                            >
                              <span className="text-sm font-medium text-[var(--foreground)]">
                                {entry.key}
                              </span>
                              <span
                                className={`text-sm ${
                                  status === "out"
                                    ? "font-medium text-amber-700"
                                    : "text-[var(--muted-foreground)]"
                                }`}
                              >
                                {entry.value}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {outOfSpec > 0 && (
                        <p className="mt-2 text-xs text-amber-600">
                          {outOfSpec === 1
                            ? "1 element is outside the LM6 limit"
                            : `${outOfSpec} elements are outside the LM6 limit`}
                        </p>
                      )}
                    </>
                  )}
                </section>
              )}

              {selectedRecord.notes && (
                <section>
                  <h4 className="mb-2 font-medium text-[var(--foreground)]">
                    Notes
                  </h4>
                  <p className="rounded-lg bg-[var(--muted)] p-3 text-[var(--muted-foreground)]">
                    {selectedRecord.notes}
                  </p>
                </section>
              )}
            </div>
          );
        })()}

        <ModalFooter className="justify-between">
          <span className="min-w-0 truncate text-sm text-[var(--muted-foreground)]">
            {selectedRecord
              ? `${selectedRecord.batchNumber} · ${formatDate(
                  new Date(selectedRecord.date)
                )}`
              : ""}
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              setIsViewModalOpen(false);
              setSelectedRecord(null);
            }}
          >
            Close
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
