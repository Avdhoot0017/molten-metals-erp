"use client";

import * as React from "react";
import {
  ArrowRight,
  Factory,
  PackageCheck,
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
  compositionGramsToInputs,
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
  "create" | "melt" | "parts" | "complete" | "amend",
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
  parts: {
    title: "Castings Poured",
    description:
      "Count the castings off this heat and what is left in the furnace.",
    action: "Save Castings",
  },
  complete: {
    title: "Complete Batch",
    description: "Weigh the scrap this batch produced and close it.",
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
import {
  MAX_OPEN_BATCHES_PER_FURNACE,
  batchPrefix,
  castingOutput,
  chargeOf,
  suggestedHeel,
} from "@/lib/production";
import { announcePiecesChanged } from "@/lib/live-updates";
import {
  parseWeightInput,
  weightForExport,
  weightToInput,
  WEIGHT_UNIT,
} from "@/lib/units";
import { expectedScrapOf } from "@/lib/parts";

/**
 * How much metal one casting of this part takes out of the furnace.
 *
 * The pouring weight, because the gating is poured with the casting and comes
 * out of the same heat. A part recorded before pouring weights were tracked
 * falls back to its finished weight - understating it slightly, which is the
 * safe direction for a limit.
 */
function castingMetal(part: { weightPerPiece: number; pouringWeight: number | null }): number {
  return part.pouringWeight || part.weightPerPiece;
}

/*
 * There is no allowance band and no block.
 *
 * Castings that need more metal than went into the furnace are worth stopping
 * to explain - the weights may be wrong, or metal may have come from somewhere
 * nobody wrote down - but the person at the furnace knows what happened and
 * the system does not. So it asks for a note and saves what they tell it.
 */

interface Part {
  id: string;
  partCode: string;
  name: string;
  /** The finished casting, in grams. */
  weightPerPiece: number;
  /**
   * Metal poured for one casting, in grams - the part plus its gating. Null on
   * parts recorded before it was tracked; those are left out of the expected
   * figures rather than counted as nothing.
   */
  pouringWeight: number | null;
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
      pouringWeight: number | null;
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
  /** Metal still in the furnace when this batch closed. Null if not recorded. */
  metalRemaining?: number | null;
  /** Metal melted in from the previous heat - charge, but never stock. */
  carriedInWeight?: number;
  carriedFrom?: { id: string; batchNumber: string } | null;
  carriedTo?: { id: string; batchNumber: string } | null;
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
    "create" | "melt" | "parts" | "complete" | "amend" | null
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
    operatorId: "",
    batchNumber: "",
    batchDate: "",
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
    metalRemaining: "",
    notes: "",
  });

  // One line per part in the batch, shown as removable chips
  const [partLines, setPartLines] = React.useState<PartLine[]>([]);
  const [partToAdd, setPartToAdd] = React.useState("");

  // Fixed LM6 element readings, keyed by chemical symbol
  const [elementValues, setElementValues] = React.useState<Record<string, string>>({});
  /**
   * Grams of each element added to the melt.
   *
   * Kept apart from the readings because they answer different questions:
   * what the heat contains, and what was put in to get it there. A heat can
   * have one without the other - an addition made before the re-assay, or a
   * reading on a heat nobody corrected.
   */
  const [elementGrams, setElementGrams] = React.useState<Record<string, string>>({});
  /**
   * Which elements are showing their "added" box.
   *
   * Most heats are assayed without anything being thrown in, so the box is
   * opened per element rather than standing empty on every row. A batch that
   * already has additions recorded opens them itself - see openStage.
   */
  const [gramsOpen, setGramsOpen] = React.useState<Set<string>>(new Set());
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
  /**
   * Metal still sitting in a furnace from a previous heat, unclaimed.
   *
   * Reloaded whenever the create form opens: a heel can be taken by another
   * operator between one batch and the next, and offering metal that is
   * already gone would only produce a refusal on save.
   */
  /** Shop-floor employees, for naming who ran a heat. */
  const [employees, setEmployees] = React.useState<
    Array<{ id: string; name: string; employeeCode: string }>
  >([]);
  const [heels, setHeels] = React.useState<
    Array<{
      id: string;
      batchNumber: string;
      metalRemaining: number;
      ingotGrade: AluminumType;
      /** Whether the batch it came from has been closed yet. */
      status?: ProductionStatus;
      furnaceId: string | null;
      furnace: { id: string; name: string } | null;
    }>
  >([]);
  const [carriedFromId, setCarriedFromId] = React.useState<string | null>(null);
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
    const [partsRes, furnacesRes, stockRes, heelsRes, employeesRes] =
      await Promise.all([
      fetch("/api/parts"),
      fetch("/api/furnaces"),
      // Stock comes from the production-scoped endpoint, not /api/inventory:
      // a production manager charges furnaces without holding inventory
      // access, and reading 0 kg for every grade would block them entirely.
      fetch("/api/production/stock"),
      // What previous heats left behind and nobody has claimed yet
      fetch("/api/production/heels"),
      // Who can be named as having run a heat
      fetch("/api/employees"),
    ]);
    const partsData = await partsRes.json();
    const furnacesData = await furnacesRes.json();
    const stockData = await stockRes.json();
    const heelsData = await heelsRes.json();
    if (partsData.success) setParts(partsData.data);
    if (furnacesData.success) setFurnaces(furnacesData.data || []);
    if (heelsData.success) setHeels(heelsData.data || []);

    const employeesData = await employeesRes.json();
    if (employeesData.success) {
      const list = Array.isArray(employeesData.data)
        ? employeesData.data
        : employeesData.data?.employees ?? [];
      setEmployees(
        (
          list as Array<{
            id: string;
            name: string;
            employeeCode: string;
            isActive: boolean;
          }>
        ).filter((e) => e.isActive)
      );
    }
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
  /*
   * A heat is written up in two sittings, so its output is two sections.
   *
   * The castings are counted as they come off the line; the scrap is weighed
   * later, once it has been collected and the runners cut. Asking for both at
   * once meant one of them was always a guess. Amending shows the lot.
   */
  const showParts = batchModal === "parts" || batchModal === "amend";
  const showScrap = batchModal === "complete" || batchModal === "amend";
  /** Anything output-related is on screen - used for figures both halves share. */
  const showOutput = showParts || showScrap;
  const isAmending = batchModal === "amend";
  const furnaceOptions = furnaces.map((f) => ({ value: f.id, label: f.name }));

  /**
   * The same list, with any metal still standing in each furnace named on it.
   *
   * The panel offering a heel only appears once a furnace is chosen, so until
   * then nothing said which furnace had 856 kg waiting in it - the metal was
   * there, and invisible, at exactly the moment somebody is deciding how much
   * ingot to charge.
   */
  const furnaceChargeOptions = furnaces.map((f) => {
    const waiting = heels.filter((h) => h.furnaceId === f.id);
    if (waiting.length === 0) return { value: f.id, label: f.name };
    const total = waiting.reduce((sum, h) => sum + h.metalRemaining, 0);
    return {
      value: f.id,
      label: `${f.name} - ${formatWeight(total)} of ${gradeName(waiting[0].ingotGrade)} still in it`,
    };
  });
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

  /*
   * Metal left in the chosen furnace by its last heat.
   *
   * Only the heels that can actually go into THIS heat are offered: same
   * furnace, because molten metal does not move on its own, and same alloy,
   * because an LM6 heel in an LM9 heat contaminates it. Anything else would be
   * a choice the server is going to refuse.
   */
  const usableHeels = heels.filter(
    (h) =>
      h.furnaceId === formData.furnaceId && h.ingotGrade === formData.ingotGrade
  );
  // Carrying the leftover is compulsory - molten metal already in the furnace
  // cannot be left behind. So when a usable heel exists the charge always
  // includes one: the operator's explicit pick, or the first usable heel by
  // default (they can only change WHICH when more than one is waiting). It is
  // only ever null when there is genuinely no leftover.
  const chosenHeel =
    usableHeels.find((h) => h.id === carriedFromId) ?? usableHeels[0] ?? null;
  const carriedWeight = chosenHeel?.metalRemaining ?? 0;

  // The charge is everything in the furnace. Only the first two came out of
  // stock - the heel was deducted when the batch that left it was charged.
  const totalCharge = ingotChargeTotal + scrapUsedTotal + carriedWeight;

  const resetForm = () => {
    setCarriedFromId(null);
    setManualScrap(new Set());
    setFormData({
      furnaceId: "",
      operatorId: "",
      batchNumber: "",
      batchDate: "",
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
      metalRemaining: "",
      notes: "",
    });
    setPartLines([]);
    setPartToAdd("");
    setElementValues({});
    setElementGrams({});
    setGramsOpen(new Set());
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
   * What the parts on this batch say the metal should look like.
   *
   * Each part carries its pouring weight and the gating that comes off it, so
   * once the counts are entered both figures follow: how much runner scrap to
   * expect back, and how much metal the moulds took in total. Shown next to the
   * inputs so the operator can compare before saving - they are a reference,
   * not a limit, and nothing is validated against them.
   *
   * Counted on castings poured, not good ones: a casting that was rejected
   * still had its gating cut off.
   */
  const expectedFromParts = React.useMemo(() => {
    const lines = partLines
      .map((line) => {
        const qty = parseInt(line.quantityProduced) || 0;
        const part = parts.find((p) => p.id === line.partId);
        if (qty <= 0 || !part) return null;
        return {
          quantityProduced: qty,
          goodParts: parseInt(line.goodParts) || 0,
          part: {
            weightPerPiece: part.weightPerPiece,
            pouringWeight: part.pouringWeight,
          },
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);

    // Same function the server uses to work these out, so the figures on
    // screen and the figures saved cannot drift apart
    const out = castingOutput(lines);
    return { ...out, known: lines.length > 0 && out.complete };
  }, [partLines, parts]);

  /**
   * The charge this batch had to work with, and what should be left of it.
   *
   * Charge is fixed once the furnace is charged, so it comes off the record
   * being completed; what is left is that less everything poured into moulds.
   */
  /*
   * The metal this batch had to pour from.
   *
   * Fixed when completing - the charge was recorded hours ago and is not on
   * screen. When amending it IS on screen and being edited, so the figures
   * have to follow what is being typed; reading the stored charge there meant
   * raising it to fix an over-poured batch changed nothing.
   */
  const completionCharge = isAmending
    ? totalCharge + (editingRecord?.carriedInWeight ?? 0)
    : editingRecord
    ? chargeOf(editingRecord)
    : totalCharge;
  const suggestedRemaining = suggestedHeel(
    completionCharge,
    expectedFromParts.poured
  );

  /**
   * What the castings entered would take out of the furnace, against what went
   * in.
   *
   * A heat charged with 100 kg making 15 castings that need 10 kg each is
   * usually a miscount - the metal was not there. Usually, not always: metal
   * gets added from another furnace and a part weight can be wrong on the
   * drawing. So this asks for a note rather than refusing the figures.
   */
  const capacity = React.useMemo(() => {
    let needed = 0;
    // The largest castings first - they are what a count has to come off
    for (const line of partLines) {
      const qty = parseInt(line.quantityProduced) || 0;
      if (qty <= 0) continue;
      const part = parts.find((p) => p.id === line.partId);
      if (!part) continue;
      needed += qty * castingMetal(part);
    }

    // One part is the common case, and the only one where "that many fit" is
    // unambiguous advice
    const only = partLines.length === 1
      ? parts.find((p) => p.id === partLines[0].partId)
      : undefined;
    const maxCastings = only
      ? Math.floor(completionCharge / Math.max(1, castingMetal(only)))
      : null;

    return {
      needed,
      over: completionCharge > 0 && needed > completionCharge,
      maxCastings,
    };
  }, [partLines, parts, completionCharge]);

  /*
   * Scrap fields fill themselves in from the parts.
   *
   * Every casting's gating comes off it and every rejected casting is scrap,
   * and the parts carry the weights, so making the operator work that out on
   * paper was asking for arithmetic they should not have to do. Typing in a
   * field marks it theirs and this stops touching it - the bench scale wins
   * over the calculation, the same way it does on the fettling sheet.
   *
   * Only on a fresh completion: amending a saved batch prefills the figures
   * that were actually recorded, which must not be overwritten.
   */
  const [manualScrap, setManualScrap] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    /*
     * Each figure fills in on the stage that shows it.
     *
     * This guard used to name "complete" and "amend" only - written before the
     * castings and the scrap became separate stages. The leftover then moved
     * to the castings stage, which this did not list, so the field sat empty
     * there and saved as 0: a furnace with 100 kg still in it recorded as
     * empty, and the next heat offered nothing to carry over.
     */
    if (!showParts && !showScrap) return;
    if (expectedFromParts.poured <= 0) return;
    setFormData((prev) => ({
      ...prev,
      /*
       * The scrap figures need the parts' pouring weights - without them the
       * gating is unknown and a guess would be worse than a blank.
       *
       * What is left in the furnace does not: it is what went in less what was
       * poured, and the castings' own weight is a floor for that even when the
       * gating was never measured. So it fills itself in either way.
       */
      // Scrap is weighed at the closing stage, so it fills in there
      ...(showScrap && expectedFromParts.known
        ? {
            runnerRaiserScrap: manualScrap.has("runnerRaiserScrap")
              ? prev.runnerRaiserScrap
              : weightToInput(expectedFromParts.runnerRaiser),
            rejectedPartScrap: manualScrap.has("rejectedPartScrap")
              ? prev.rejectedPartScrap
              : weightToInput(expectedFromParts.rejectedPart),
          }
        : {}),
      // What is left in the furnace is asked for with the castings
      ...(showParts
        ? {
            metalRemaining: manualScrap.has("metalRemaining")
              ? prev.metalRemaining
              : weightToInput(suggestedRemaining),
          }
        : {}),
    }));
  }, [batchModal, expectedFromParts, suggestedRemaining, manualScrap]);



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
    // Any of the three will do: a heat can run on fresh ingot, on re-melted
    // scrap, or on nothing but what the last heat left behind. What it cannot
    // be is empty.
    if (totalCharge <= 0) {
      setError(
        `Enter the ${selectedGrade.grade} ingot or scrap charged into this heat, or carry over the metal left in the furnace`
      );
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
      // Blank is allowed - the batch matters more than the label on it
      operatorId: formData.operatorId || null,
      // Only sent when writing up an earlier day; the server refuses these
      // from anyone but an admin
      ...(backdating
        ? {
            batchNumber: formData.batchNumber.trim(),
            date: formData.batchDate || undefined,
          }
        : {}),
      // The server re-reads the weight from that batch rather than trusting a
      // number from here - it is metal, and only one heat may have it.
      // Resolved (not the raw state) so the compulsory default heel is carried
      // even when the operator never explicitly picked one.
      carriedFromId: chosenHeel?.id ?? null,
      // Sent explicitly: with no ingot at all there is nothing for the server
      // to infer the alloy from
      ingotGrade: formData.ingotGrade,
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
      composition: buildCompositionEntries(elementValues, elementGrams),
    });
  };

  /** Stage 3 - count the castings and what is left in the furnace. */
  const handleRecordParts = async () => {
    if (!editingRecord) return;

    /*
     * The only thing standing in the way: an unexplained overshoot.
     *
     * The figures are saved either way - the person at the furnace knows what
     * happened - but a batch whose parts need more metal than went in is
     * unreadable a month later without a line saying why.
     */
    if (capacity.over && formData.notes.trim().length < 10) {
      setError(
        "Write a proper reason (a sentence or so) for making more parts than the metal can make"
      );
      return;
    }

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
      // The castings and what they left behind. No scrap figures: the runners
      // have not been cut and weighed yet, and sending 0 would book that.
      stage: "parts",
      items: partLines.map((line) => ({
        partId: line.partId,
        quantityProduced: parseInt(line.quantityProduced) || 0,
        goodParts: parseInt(line.goodParts) || 0,
      })),
      metalRemaining: parseWeightInput(formData.metalRemaining),
      notes: formData.notes,
    });
  };

  /** Stage 4 - weigh the scrap and close the batch. */
  const handleCompleteBatch = async () => {
    if (!editingRecord) return;

    await submitBatch(`/api/production/${editingRecord.id}`, "PATCH", {
      // The castings were counted at the previous stage and are not on screen,
      // so they are left out and the batch keeps what it already holds
      stage: "complete",
      runnerRaiserScrap: parseWeightInput(formData.runnerRaiserScrap),
      spillageScrap: parseWeightInput(formData.spillageScrap),
      rejectedPartScrap: parseWeightInput(formData.rejectedPartScrap),
      // Not sent: the figure was set with the castings and is not on this
      // screen, so the batch keeps what it already holds
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
        // Completing or amending a batch puts castings on the shop floor, so
        // an open Shop Floor or Fettling tab needs to know
        announcePiecesChanged();
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

  /**
   * Writing up a heat that ran weeks ago.
   *
   * Same form, two extra answers: which day it ran and what number it was
   * given. Both belong to the record - a batch from last month carries last
   * month's number - so neither can be invented here.
   */
  const [backdating, setBackdating] = React.useState(false);

  /**
   * The prefix numbers for the chosen month start with - "26J" for October
   * 2026 - so the admin is told the shape before typing rather than after.
   * Worked out from the same helper the allocator uses, so the two agree.
   */
  const expectedBatchPrefix = formData.batchDate
    ? batchPrefix(new Date(`${formData.batchDate}T00:00:00`))
    : "";

  const openCreate = (previous = false) => {
    setEditingRecord(null);
    setError("");
    resetForm();
    setBackdating(previous);
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
    stage: "melt" | "parts" | "complete" | "amend"
  ) => {
    setEditingRecord(record);
    setError("");

    const wantsMelt = stage === "melt" || stage === "amend";
    // The castings and the furnace figure belong to the parts stage; the scrap
    // to the closing one. Amending opens all of it.
    const wantsParts = stage === "parts" || stage === "amend";
    const wantsScrap = stage === "complete" || stage === "amend";
    const wantsOutput = wantsParts || wantsScrap;
    const wantsCharge = stage === "amend";

    if (wantsMelt) {
      // Stored values carry their unit ("12%"); the inputs are numeric, so
      // they come back through the boundary that strips it
      const values = compositionToInputs(record.composition);
      setElementValues(values);
      setElementGrams(compositionGramsToInputs(record.composition));
      setGramsOpen(new Set(Object.keys(compositionGramsToInputs(record.composition))));
      // Al was typed by hand if it is on the record, so do not overwrite it
      // with the computed balance
      setAlIsAuto(!values.Al);
    } else {
      setElementValues({});
      setElementGrams({});
      setGramsOpen(new Set());
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
            /*
             * The metal left in the furnace, as recorded.
             *
             * This was missing, so amending a batch opened the field blank and
             * saved 0 over whatever was there - quietly emptying a furnace
             * that still had metal in it, and losing a heel the next heat was
             * waiting to carry.
             */
            metalRemaining: kg(record.metalRemaining ?? 0),
            notes: record.notes ?? "",
          }
        : {}),
    }));

    /*
     * A figure already on the record stands as entered - reopening a batch
     * must not silently restate what somebody wrote. One that was never
     * recorded (a batch closed before this was tracked) is left for the
     * calculation below to fill in.
     */
    const recorded = new Set<string>();
    if (wantsOutput) {
      // A figure already on the record stands as entered - reopening a batch
      // must not silently restate what somebody wrote down
      if (record.runnerRaiserScrap > 0) recorded.add("runnerRaiserScrap");
      if (record.rejectedPartScrap > 0) recorded.add("rejectedPartScrap");
      /*
       * What is left in the furnace is NOT seeded, on purpose.
       *
       * The scrap figures above were weighed - nobody can recompute them, so
       * they stand as recorded. This one is arithmetic: everything charged
       * less everything poured. An admin opening Update is usually correcting
       * a count or the charge, and the metal left has to follow the figures it
       * comes from rather than keeping a total that no longer matches them.
       * Typing in the field still stops it, and the hint below shows what was
       * recorded before, so a deliberate figure is never lost silently.
       */
    }
    // Whatever was never recorded is left for the calculation to fill in
    setManualScrap(recorded);

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
    if (totalCharge <= 0) {
      setError("Enter the ingot or the scrap charged into this heat");
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
      ingotGrade: formData.ingotGrade,
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
      composition: buildCompositionEntries(elementValues, elementGrams),
      items: partLines.map((line) => ({
        partId: line.partId,
        quantityProduced: parseInt(line.quantityProduced) || 0,
        goodParts: parseInt(line.goodParts) || 0,
      })),
      runnerRaiserScrap: parseWeightInput(formData.runnerRaiserScrap),
      spillageScrap: parseWeightInput(formData.spillageScrap),
      rejectedPartScrap: parseWeightInput(formData.rejectedPartScrap),
      metalRemaining: parseWeightInput(formData.metalRemaining),
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
          {/* Catching up on heats that ran before anyone wrote them down.
              Admin only, because it sets the batch number and the date by
              hand - the two things the ordinary form will not let anyone
              choose. */}
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => openCreate(true)}>
              <Clock className="h-4 w-4 mr-2" />
              Add Previous Batch
            </Button>
          )}
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
                              {/* The three stages, in the order the heat runs:
                                  the melt is read, the castings are counted,
                                  the scrap is weighed. Each opens only once
                                  the one before it has been done, so the row
                                  shows how far the batch has got. */}
                              <Button
                                variant="ghost"
                                size="icon"
                                title={
                                  record.status === "PENDING"
                                    ? "1. Add the melt reading"
                                    : "1. Edit the melt reading"
                                }
                                onClick={() => openStage(record, "melt")}
                              >
                                <FlaskRound className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={record.status === "PENDING"}
                                title={
                                  record.status === "PENDING"
                                    ? "Add the melt reading first"
                                    : record.items.length > 0
                                    ? "2. Edit the castings counted"
                                    : "2. Count the castings poured"
                                }
                                onClick={() => openStage(record, "parts")}
                              >
                                <Package className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={record.items.length === 0}
                                title={
                                  record.items.length === 0
                                    ? "Count the castings first"
                                    : "3. Weigh the scrap and close this batch"
                                }
                                onClick={() => openStage(record, "complete")}
                                className={
                                  record.items.length > 0
                                    ? "text-green-700 hover:text-green-800"
                                    : undefined
                                }
                              >
                                <CheckCircle2 className="h-4 w-4" />
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
        title={
          batchModal === "create" && backdating
            ? "Add a Previous Batch"
            : MODAL_COPY[batchModal ?? "create"].title
        }
        description={
          editingRecord
            ? `${editingRecord.batchNumber} - ${MODAL_COPY[batchModal ?? "create"].description}`
            : batchModal === "create" && backdating
            ? "A heat that already ran. Give the day it ran and the number it was given."
            : MODAL_COPY[batchModal ?? "create"].description
        }
        size="xl"
      >
        <div className="space-y-6">
          {/* More castings entered than the charge could have poured.
              At the top, because it is the reason the button below is dead -
              a disabled control with its explanation out of sight sends people
              hunting for what is wrong. */}
          {showParts && capacity.over && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div className="text-sm text-amber-900">
                  <p className="font-medium">
                    More parts than the metal can make
                  </p>
                  <p className="mt-1">
                    {batchTotals.quantityProduced} part
                    {batchTotals.quantityProduced === 1 ? "" : "s"} need{" "}
                    <span className="font-semibold">
                      {formatWeight(capacity.needed)}
                    </span>{" "}
                    of metal. Only{" "}
                    <span className="font-semibold">
                      {formatWeight(completionCharge)}
                    </span>{" "}
                    went into this furnace.
                    {capacity.maxCastings !== null && (
                      <> That is enough for about {capacity.maxCastings} parts.</>
                    )}
                  </p>
                  <p className="mt-1.5">
                    Check the count first. If the count is right, type the
                    reason below &mdash; then save.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Parts in this batch - only at completion, when they are counted */}
          {showParts && (
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

                      {/* One plain sentence: what this many parts eat, and
                          what that leaves in the furnace.
                          It used to read "10 parts use 100.00 kg of metal ·
                          25.00 kg comes back as scrap · 5 bad = 50.00 kg" -
                          three facts at once, and the two scrap figures are
                          already written in their own boxes further down. */}
                      {qty > 0 && part && (
                        <p className="mt-2 text-xs font-medium text-amber-600">
                          {qty} part{qty === 1 ? "" : "s"} use{" "}
                          {formatWeight(qty * castingMetal(part))} of metal.
                          {/* Only with a single part is "what is left" this
                              line's business - with two, the furnace holds
                              what BOTH of them left, and the panel below says
                              so for the batch as a whole */}
                          {partLines.length === 1 && completionCharge > 0 && (
                            <>
                              {" "}
                              {suggestedRemaining > 0
                                ? `${formatWeight(suggestedRemaining)} left in the bhatti.`
                                : "Nothing left in the bhatti."}
                            </>
                          )}
                          {!part.pouringWeight && (
                            <span className="text-[var(--muted-foreground)]">
                              {" "}
                              (pouring weight not set for this part)
                            </span>
                          )}
                        </p>
                      )}
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
            {backdating && (
              <div className="mb-4 rounded-lg border border-[var(--primary)]/30 bg-[var(--accent)] p-3">
                <p className="mb-3 text-sm font-medium text-[var(--foreground)]">
                  A batch that already ran
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Date it ran"
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={formData.batchDate}
                    onChange={(e) =>
                      setFormData({ ...formData, batchDate: e.target.value })
                    }
                    className="h-12"
                  />
                  <Input
                    label="Batch number"
                    placeholder={expectedBatchPrefix ? `${expectedBatchPrefix}01` : "26I01"}
                    value={formData.batchNumber}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        batchNumber: e.target.value.toUpperCase(),
                      })
                    }
                    className="h-12"
                  />
                </div>
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                  {expectedBatchPrefix
                    ? `Numbers for that month start ${expectedBatchPrefix} - for example ${expectedBatchPrefix}01. The system will say if that number is already used.`
                    : "Pick the date first, then the number for that month."}
                </p>
              </div>
            )}

            {/* Who was actually on the furnace. Optional: the login name
                records who typed the batch in, usually a manager writing up
                someone else's shift, and losing a whole heat over a missing
                label would be the worse trade. */}
            {batchModal === "create" && (
              <Select
                label="Operator - who ran this batch (optional)"
                options={[
                  { value: "", label: "Not recorded" },
                  ...employees.map((e) => ({
                    value: e.id,
                    label: `${e.name} (${e.employeeCode})`,
                  })),
                ]}
                value={formData.operatorId}
                onChange={(value) =>
                  setFormData({ ...formData, operatorId: value })
                }
                className="mb-4 h-12"
              />
            )}
            <Select
              label="Furnace (Bhatti)"
              options={furnaceChargeOptions}
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
              Pick the grade this heat was charged with, then enter what went
              in. Fresh ingot, re-melted scrap, or both &mdash; at least one.
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

            {/* The alloy spec only. The stock figure sits on the input below,
                where the decision about how much to charge is actually made -
                saying it twice just competes with itself. */}
            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              {selectedGrade.description}
              {stockLoadFailed && (
                <>
                  {" \u00b7 "}
                  <span className="text-[var(--error)]">
                    stock levels unavailable
                  </span>
                </>
              )}
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
                // What is available, and - once a weight is typed - what would
                // be left. The operator is deciding how much to charge, and
                // that decision is about the remainder, not the total.
                !stockKnown
                  ? "Fresh ingot charged into this heat. Optional if scrap is used."
                  : ingotChargeTotal > selectedGradeStock
                  ? undefined
                  : ingotChargeTotal > 0
                  ? `${formatWeight(selectedGradeStock)} available · ${formatWeight(
                      selectedGradeStock - ingotChargeTotal
                    )} left after this heat`
                  : `${formatWeight(selectedGradeStock)} of ${selectedGrade.grade} available. Optional if scrap is used.`
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

            {/* Metal the last heat on this furnace did not pour.
                Offered only when creating - amending a batch cannot change
                which heel it was built on without rewriting the batch that
                left it. */}
            {batchModal === "create" && usableHeels.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">
                  Metal still in {selectedFurnace?.name ?? "this furnace"} &mdash; carried
                  into this heat
                </p>
                {/* Carrying the leftover is mandatory, so there is nothing to
                    tick - a control implies a choice that does not exist, and
                    an unticked box implies the metal stays behind.
                    More than one leftover on the same furnace and alloy is the
                    only case with a real decision, and that is offered as a
                    plain link rather than a form control. */}
                <div className="mt-2 space-y-2">
                  {usableHeels.map((heel) => {
                    const picked = chosenHeel?.id === heel.id;
                    const line = (
                      <span>
                        Batch {heel.batchNumber} left{" "}
                        <span className="font-semibold">
                          {formatWeight(heel.metalRemaining)}
                        </span>{" "}
                        of {gradeName(heel.ingotGrade)}.{" "}
                        {picked
                          ? "It is melted into this heat."
                          : "It stays in the furnace for a later heat."}
                        {heel.status && heel.status !== "COMPLETED" && (
                          <span className="block text-xs text-amber-800">
                            That batch is still open - its scrap has not been weighed yet,
                            but the metal is in the furnace now.
                          </span>
                        )}
                      </span>
                    );
                    return (
                      <div
                        key={heel.id}
                        className={`flex items-start gap-2 text-sm ${
                          picked ? "text-amber-900" : "text-[var(--muted-foreground)]"
                        }`}
                      >
                        <ArrowRight
                          className={`mt-0.5 h-4 w-4 shrink-0 ${
                            picked ? "text-amber-700" : "opacity-40"
                          }`}
                        />
                        <span>
                          {line}
                          {!picked && (
                            <button
                              type="button"
                              onClick={() => setCarriedFromId(heel.id)}
                              className="ml-1 cursor-pointer font-medium text-[var(--primary)] hover:underline"
                            >
                              Use this one instead
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs font-medium text-amber-800">
                  This leftover metal is in the furnace now, so it is always melted into the
                  next heat &mdash; it cannot be left behind.
                </p>
                {chosenHeel && (
                  <p className="mt-1 text-xs text-amber-800">
                    It is already out of stock - it left inventory when batch{" "}
                    {chosenHeel.batchNumber} was charged - so nothing is deducted for it
                    again.
                  </p>
                )}
              </div>
            )}

            {totalCharge > 0 && (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                Total charge:{" "}
                <span className="font-medium text-[var(--foreground)]">
                  {formatWeight(totalCharge)}
                </span>
                {scrapUsedTotal > 0 && (
                  <> &middot; {formatWeight(scrapUsedTotal)} of it re-melted scrap</>
                )}
                {carriedWeight > 0 && (
                  <>
                    {" "}
                    &middot;{" "}
                    <span className="text-amber-700">
                      {formatWeight(carriedWeight)} carried over from{" "}
                      {chosenHeel?.batchNumber}
                    </span>
                  </>
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

            {/* A row per element, with the spec beside it.
                Two facts are recorded, and they are not the same thing: what
                the spectro read, and what was thrown in to get it there. A
                grid of single boxes had nowhere to put the second, and a
                dozen elements down a page is a table, so it is one - with the
                header pinned and the list scrolling inside it. */}
            <div className="max-h-[22rem] overflow-auto rounded-lg border border-[var(--border)]">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[var(--card)]">
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-4 py-2.5 text-left text-sm font-semibold">
                      Element
                    </th>
                    <th className="px-4 py-2.5 text-left text-sm font-semibold">
                      LM6 limit
                    </th>
                    <th className="px-4 py-2.5 text-left text-sm font-semibold">
                      Actual %
                    </th>
                    <th className="px-4 py-2.5 text-left text-sm font-semibold">
                      Added (g)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {LM6_ELEMENTS.map((element) => {
                    const raw = elementValues[element.symbol] ?? "";
                    const grams = elementGrams[element.symbol] ?? "";
                    const { error, warning } = element.isRemainder
                      ? { error: null, warning: null }
                      : checkElementValue(element, raw);
                    const balance = element.isRemainder
                      ? aluminiumBalance(elementValues)
                      : null;

                    return (
                      <tr
                        key={element.symbol}
                        className="border-b border-[var(--border)] last:border-0"
                      >
                        <td className="px-4 py-2.5">
                          <span className="block text-sm font-medium text-[var(--foreground)]">
                            {element.name}
                          </span>
                          <span className="block text-xs text-[var(--muted-foreground)]">
                            {element.symbol}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-[var(--muted-foreground)]">
                          {element.limit}
                        </td>
                        <td className="px-4 py-2.5">
                          <Input
                            type="number"
                            step="0.001"
                            min="0"
                            max="100"
                            inputMode="decimal"
                            placeholder={
                              balance?.overflow ? "Check readings" : "%"
                            }
                            value={raw}
                            error={
                              balance?.overflow
                                ? `Others total ${balance.total}%`
                                : error ?? undefined
                            }
                            className={
                              !error && warning
                                ? "border-amber-500 focus:ring-amber-500"
                                : undefined
                            }
                            onChange={(e) => {
                              // Aluminium stops following the balance the
                              // moment somebody types their own reading
                              if (element.isRemainder) setAlIsAuto(false);
                              setElementValue(element.symbol, e.target.value);
                            }}
                          />
                          {!error && warning && (
                            <p className="mt-1 text-xs text-amber-600">{warning}</p>
                          )}
                          {element.isRemainder && !balance?.overflow && (
                            <p className="mt-1 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                              {alIsAuto ? (
                                <>Balance of the heat, filled in for you</>
                              ) : (
                                <>
                                  Entered by hand
                                  <button
                                    type="button"
                                    onClick={restoreAutoAluminium}
                                    className="cursor-pointer font-medium text-[var(--primary)] hover:underline"
                                  >
                                    Use balance
                                  </button>
                                </>
                              )}
                            </p>
                          )}
                        </td>
                        {/* The reading is the usual job; an addition is the
                            exception. Twelve empty boxes for the exception
                            made the table look like twice the work it is, so
                            the box is asked for rather than always there. */}
                        <td className="px-4 py-2.5">
                          {gramsOpen.has(element.symbol) ? (
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                step="any"
                                min="0"
                                inputMode="decimal"
                                placeholder="0"
                                autoFocus
                                value={grams}
                                onChange={(e) =>
                                  setElementGrams((current) => ({
                                    ...current,
                                    [element.symbol]: e.target.value,
                                  }))
                                }
                              />
                              <button
                                type="button"
                                title="No addition for this element"
                                onClick={() => {
                                  // Closing clears it: a hidden figure would
                                  // still be saved, and nothing on screen
                                  // would say so
                                  setElementGrams((current) => ({
                                    ...current,
                                    [element.symbol]: "",
                                  }));
                                  setGramsOpen((current) => {
                                    const next = new Set(current);
                                    next.delete(element.symbol);
                                    return next;
                                  });
                                }}
                                className="shrink-0 cursor-pointer rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--error)]"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              title={`Record ${element.name} added to the melt`}
                              onClick={() =>
                                setGramsOpen((current) =>
                                  new Set(current).add(element.symbol)
                                )
                              }
                              className="flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
          {showScrap && (
          <>
          <div>
            <h4 className="font-medium text-[var(--foreground)] mb-3 flex items-center gap-2">
              <Recycle className="h-4 w-4 text-[var(--primary)]" />
              Scrap Generated ({WEIGHT_UNIT})
            </h4>
            <div className="grid grid-cols-3 gap-4 items-start">
              <div>
                <Input
                  label="Runner & Raiser"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Weight in kg"
                  value={formData.runnerRaiserScrap}
                  onChange={(e) => {
                    setManualScrap((m) => new Set(m).add("runnerRaiserScrap"));
                    setFormData({ ...formData, runnerRaiserScrap: e.target.value });
                  }}
                  className="h-12"
                />
                {expectedFromParts.known && (
                  <p className="mt-1.5 text-xs font-medium text-amber-600">
                    {manualScrap.has("runnerRaiserScrap")
                      ? `These parts should give about ${formatWeight(expectedFromParts.runnerRaiser)}`
                      : `We filled this in: ${formatWeight(expectedFromParts.runnerRaiser)}`}
                  </p>
                )}
              </div>
              <div>
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
                {/* The one scrap figure the castings cannot give: spillage is
                    metal that never reached a mould. What is left unaccounted
                    is the most it can be. */}
                {expectedFromParts.known && completionCharge > 0 && (
                  <p className="mt-1.5 text-xs font-medium text-amber-600">
                    At most{" "}
                    {formatWeight(
                      Math.max(
                        0,
                        completionCharge -
                          expectedFromParts.poured -
                          parseWeightInput(formData.metalRemaining)
                      )
                    )}{" "}
                    of metal is not accounted for yet
                  </p>
                )}
              </div>
              <div>
                <Input
                  label="Rejected Part Scrap"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Weight in kg"
                  value={formData.rejectedPartScrap}
                  onChange={(e) => {
                    setManualScrap((m) => new Set(m).add("rejectedPartScrap"));
                    setFormData({
                      ...formData,
                      rejectedPartScrap: e.target.value,
                    });
                  }}
                  className="h-12"
                />
                {expectedFromParts.known && (
                  <p className="mt-1.5 text-xs font-medium text-amber-600">
                    {manualScrap.has("rejectedPartScrap")
                      ? `The bad parts weigh about ${formatWeight(expectedFromParts.rejectedPart)}`
                      : `We filled this in: ${formatWeight(expectedFromParts.rejectedPart)}`}
                  </p>
                )}
              </div>
            </div>
          </div>


          </>
          )}

          {/* What is still in the furnace.
              Asked for once, with the castings - those counts are what decide
              it - and outside the scrap block, which is where it used to sit:
              nested there, the castings stage skipped it entirely and the
              figure never appeared on the only screen that sets it. */}
          {showParts && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <h4 className="mb-1 flex items-center gap-2 font-medium text-amber-900">
                <Flame className="h-4 w-4" />
                Metal left in the furnace
              </h4>
              <p className="mb-3 text-xs text-amber-800">
                {formatWeight(completionCharge)} of metal went in and{" "}
                {formatWeight(expectedFromParts.poured)} went into the parts.
                Change the number below if the furnace has more or less than
                this.
              </p>
              <div className="max-w-xs">
                <Input
                  label={`Left in the furnace (${WEIGHT_UNIT})`}
                  type="number"
                  min="0"
                  step="any"
                  /* No placeholder: this field is filled in with a real
                     figure, and a grey "0" sitting in an empty box is
                     indistinguishable from a calculated zero. */
                  value={formData.metalRemaining}
                  onChange={(e) => {
                    setManualScrap((m) => new Set(m).add("metalRemaining"));
                    setFormData({ ...formData, metalRemaining: e.target.value });
                  }}
                  className="h-12"
                />
                {/* Filled in as the counts are typed: everything charged less
                    everything poured. Typing over it makes the difference melt
                    loss. */}
                {expectedFromParts.poured > 0 && (
                  <p className="mt-1.5 text-xs font-medium text-amber-600">
                    {/* The answer first, then where it came from - the sum
                        alone left people wondering what it worked out to */}
                    {manualScrap.has("metalRemaining") ? "We make it" : "We filled this in"}
                    {": "}
                    <span className="font-semibold">
                      {formatWeight(suggestedRemaining)}
                    </span>
                    {suggestedRemaining <= 0
                      ? " - all the metal was used for the parts"
                      : ` - what is left after making the parts`}
                    {/* A figure that was saved and no longer matches the sum -
                        the admin gets to decide which is right */}
                    {isAmending &&
                      editingRecord?.metalRemaining !== null &&
                      editingRecord?.metalRemaining !== undefined &&
                      Math.abs(editingRecord.metalRemaining - suggestedRemaining) > 1 && (
                        <span className="block text-[var(--muted-foreground)]">
                          It was saved as{" "}
                          {formatWeight(editingRecord.metalRemaining)} before.
                          Type that again if it was right.
                        </span>
                      )}
                  </p>
                )}
              </div>
              {/* Said with the figure in it, because this is the number the
                  next heat gets charged with - and it is claimable as soon as
                  this is saved, without waiting for the batch to be closed. */}
              {parseWeightInput(formData.metalRemaining) > 0 ? (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-green-300 bg-green-50 p-3">
                  <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />
                  <p className="text-xs text-green-900">
                    <span className="font-semibold">
                      {formatWeight(parseWeightInput(formData.metalRemaining))}
                    </span>{" "}
                    stays in{" "}
                    {editingRecord?.furnace?.name ?? "this furnace"} and can be
                    used by the next batch on it. Pick this batch there under
                    &quot;Metal still in {editingRecord?.furnace?.name ?? "the furnace"}&quot;.
                    You do not have to complete this batch first.
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-amber-800">
                  Nothing will be left for the next batch - all the metal went
                  into the parts.
                </p>
              )}
            </div>
          )}

          {/* One note box, in the place a note belongs - the bottom of the
              form - and shown on BOTH halves of writing the heat up. It used
              to live inside the scrap block, so the castings stage had nowhere
              to write the very note it was asking for. */}
          {showOutput && (
            <Textarea
              label={
                capacity.over ? "Note - please fill this in" : "Notes (Optional)"
              }
              error={
                capacity.over && !formData.notes.trim()
                  ? "Say why there are more parts than the metal can make"
                  : undefined
              }
              placeholder={
                capacity.over
                  ? "For example: metal was added from another furnace, or the part weight is wrong"
                  : "Add any notes about this production batch..."
              }
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="min-h-[80px]"
            />
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
                      : batchModal === "parts"
                      ? "No stock moves yet. The parts are counted and the metal left in the furnace is recorded - the next batch on this furnace can use it straight away. Scrap is weighed when you complete the batch."
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
                {totalCharge > 0
                  ? `Charging ${formatWeight(totalCharge)} of ${selectedGrade.grade}` +
                    (ingotChargeTotal === 0 ? " - all re-melted scrap" : "")
                  : "Enter the ingot or scrap charged into the furnace"}
              </span>
            ) : batchModal === "melt" ? (
              <span className="text-[var(--muted-foreground)]">
                {enteredElementCount > 0
                  ? `${enteredElementCount} element${enteredElementCount > 1 ? "s" : ""} recorded`
                  : "Both parts are optional - save what you measured"}
              </span>
            ) : showParts && capacity.over ? (
              <span className="flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  Write a note to say why there are extra parts
                </span>
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
                  : batchModal === "parts"
                  ? handleRecordParts
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
          const charge = chargeOf(selectedRecord);
          const outputWeight = selectedRecord.items.reduce(
            (sum, i) => sum + i.goodParts * (i.part.weightPerPiece ?? 0),
            0
          );
          // Metal still in the furnace is accounted for too - it did not
          // vanish, it just never left
          const accounted =
            outputWeight +
            selectedRecord.totalScrap +
            (selectedRecord.metalRemaining ?? 0);
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
                  {(selectedRecord.carriedInWeight ?? 0) > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-amber-700">
                        Carried over from{" "}
                        {selectedRecord.carriedFrom?.batchNumber ?? "the last heat"}
                        <span className="ml-1 text-xs text-[var(--muted-foreground)]">
                          (already out of stock)
                        </span>
                      </span>
                      <span className="font-medium text-amber-700">
                        {formatWeight(selectedRecord.carriedInWeight ?? 0)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-y border-[var(--border)] bg-[var(--muted)] px-4 py-2.5 text-sm">
                    <span className="font-medium text-[var(--foreground)]">
                      Total charge
                    </span>
                    <span className="font-semibold">{formatWeight(charge)}</span>
                  </div>
                  {(selectedRecord.metalRemaining ?? 0) > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-amber-700">
                        Left in the furnace
                        <span className="ml-1 text-xs text-[var(--muted-foreground)]">
                          {selectedRecord.carriedTo
                            ? `(melted into ${selectedRecord.carriedTo.batchNumber})`
                            : "(waiting for the next heat)"}
                        </span>
                      </span>
                      <span className="font-medium text-amber-700">
                        {formatWeight(selectedRecord.metalRemaining ?? 0)}
                      </span>
                    </div>
                  )}
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
