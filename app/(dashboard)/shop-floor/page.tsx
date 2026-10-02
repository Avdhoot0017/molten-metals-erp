"use client";

import * as React from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { LoadingSpinner } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Pagination, type PaginationMeta } from "@/components/ui/pagination";
import { canWrite } from "@/lib/permissions";
import {
  announcePiecesChanged,
  useRefreshOnChange,
  useLatestRequest,
} from "@/lib/live-updates";
import type { UserRole } from "@/types";
import {
  Flame,
  PackageCheck,
  Wrench,
  Factory,
  ClipboardList,
  ChevronRight,
  Search,
  Recycle,
  X,
} from "lucide-react";

/**
 * Where every piece is, and what moved.
 *
 * A table first, because that is how a list of parts is scanned, sorted and
 * filtered. The flow view is one click away on each row - the picture of a
 * part's route with the pieces standing at each station, which is how a
 * single part is understood.
 *
 * Every figure counts a piece once, wherever it has reached. The old reports
 * summed each station's work, so ten castings through three benches read as
 * thirty parts; these read the piece ledger instead.
 */

interface ReportRow {
  id: string;
  partCode: string;
  name: string;
  alloyGrade: string;
  routeSteps: Array<{
    id: string;
    sequence: number;
    activityType: { id: string; name: string };
  }>;
  inProcess: number;
  inRework: number;
  ready: number;
  onFloor: number;
  bottleneck: { name: string; quantity: number } | null;
  castIn: number;
  finished: number;
  melted: number;
  /** Pieces a bench turned down but sent for repair rather than the melt. */
  sentToRepair: number;
  /** Pieces the repair bench saved and put back into the route. */
  repaired: number;
  counted: number;
  stages: Array<{ stageKey: string; quantity: number }>;
}

interface Totals {
  inProcess: number;
  inRework: number;
  ready: number;
  castIn: number;
  finished: number;
  melted: number;
}

interface HistoryRow {
  id: string;
  at: string;
  place: string;
  kind: "WAITING" | "REWORK" | "READY";
  change: number;
  before: number;
  after: number;
  source: string;
  notes: string | null;
  by: string;
}

/** Today as YYYY-MM-DD in the browser's timezone. */
function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/** The first of this month, the default start of the period. */
function monthStartISO(): string {
  return `${todayISO().slice(0, 8)}01`;
}

const fmt = (n: number) => n.toLocaleString("en-IN");

// ---------------------------------------------------------------------------
// Flow view nodes
// ---------------------------------------------------------------------------

const NODE_WIDTH = 170;
const NODE_GAP = 54;

type StationData = {
  label: string;
  position: number;
  waiting: number;
  rework: number;
  countable: boolean;
  onCount: () => void;
};

function StationNode({ data }: NodeProps<Node<StationData>>) {
  const busy = data.waiting > 0;
  return (
    <div
      className={`w-[170px] rounded-lg border px-3 py-2 shadow-sm ${
        busy
          ? "border-[var(--primary)] bg-[var(--card)]"
          : "border-[var(--border)] bg-[var(--muted)]"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-[var(--primary)]" />
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        Step {data.position}
      </p>
      <p className="truncate text-sm font-medium text-[var(--foreground)]">{data.label}</p>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span
          className={`text-xl font-semibold ${
            busy ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"
          }`}
        >
          {data.waiting}
        </span>
        <span className="text-xs text-[var(--muted-foreground)]">waiting</span>
      </div>
      {data.rework > 0 && (
        <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
          <Wrench className="h-3 w-3" />
          {data.rework} for repair
        </p>
      )}
      {data.countable && (
        <button
          type="button"
          onClick={data.onCount}
          className="mt-1.5 cursor-pointer text-[10px] text-[var(--muted-foreground)] underline hover:text-[var(--foreground)]"
        >
          Count
        </button>
      )}
      <Handle type="source" position={Position.Right} className="!bg-[var(--primary)]" />
    </div>
  );
}

type TerminalData = {
  label: string;
  value: number;
  hint: string;
  kind: "start" | "end";
  countable?: boolean;
  onCount?: () => void;
};

function TerminalNode({ data }: NodeProps<Node<TerminalData>>) {
  const start = data.kind === "start";
  return (
    <div
      className={`w-[170px] rounded-lg border px-3 py-2 ${
        start ? "border-amber-300 bg-amber-50" : "border-green-300 bg-green-50"
      }`}
    >
      {!start && <Handle type="target" position={Position.Left} className="!bg-green-600" />}
      <div className="flex items-center gap-1.5">
        {start ? (
          <Flame className="h-3.5 w-3.5 text-amber-700" />
        ) : (
          <PackageCheck className="h-3.5 w-3.5 text-green-700" />
        )}
        <p className={`text-sm font-medium ${start ? "text-amber-900" : "text-green-900"}`}>
          {data.label}
        </p>
      </div>
      <p className={`mt-1 text-xl font-semibold ${start ? "text-amber-800" : "text-green-800"}`}>
        {data.value}
      </p>
      <p className={`mt-0.5 text-[10px] ${start ? "text-amber-800" : "text-green-800"}`}>
        {data.hint}
      </p>
      {data.countable && (
        <button
          type="button"
          onClick={data.onCount}
          className="mt-1 cursor-pointer text-[10px] text-green-900 underline"
        >
          Count
        </button>
      )}
      {start && <Handle type="source" position={Position.Right} className="!bg-amber-600" />}
    </div>
  );
}

const nodeTypes = { station: StationNode, terminal: TerminalNode };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ShopFloorPage() {
  const [rows, setRows] = React.useState<ReportRow[]>([]);
  const [totals, setTotals] = React.useState<Totals | null>(null);
  const [pagination, setPagination] = React.useState<PaginationMeta | null>(null);
  const [role, setRole] = React.useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");

  // Filters. The period defaults to this month so the page opens on something
  // useful rather than on all of history.
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [from, setFrom] = React.useState(monthStartISO());
  const [to, setTo] = React.useState(todayISO());
  const [holding, setHolding] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  // The row opened in the flow view
  const [selected, setSelected] = React.useState<ReportRow | null>(null);
  const [history, setHistory] = React.useState<HistoryRow[]>([]);
  const [historyTruncated, setHistoryTruncated] = React.useState(false);
  const [historyLoading, setHistoryLoading] = React.useState(false);

  // The stock-take
  const [counting, setCounting] = React.useState<{
    partId: string;
    partCode: string;
    stageKey: string;
    place: string;
    current: number;
  } | null>(null);
  const [countValue, setCountValue] = React.useState("");
  const [countNote, setCountNote] = React.useState("");
  const [countError, setCountError] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        if (data.success) setRole(data.user.role);
      } catch {
        // Only decides whether Count is offered; the API decides what is allowed
      }
    })();
  }, []);

  const reportRequest = useLatestRequest();
  const load = React.useCallback(async () => {
    // Filters change faster than the report answers; a slow earlier request
    // must not land after a newer one and put old figures back on screen
    const ticket = reportRequest.next();
    setIsRefreshing(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (holding) params.set("holding", holding);

      const res = await fetch(`/api/parts/stages/report?${params}`);
      const data = await res.json();
      if (!reportRequest.isLatest(ticket)) return;
      if (data.success) {
        setRows(data.data);
        setTotals(data.totals);
        setPagination(data.pagination);
      } else {
        setError(data.error || "Could not load the shop floor");
      }
    } catch {
      if (reportRequest.isLatest(ticket)) setError("Could not load the shop floor");
    } finally {
      if (reportRequest.isLatest(ticket)) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [page, pageSize, debouncedSearch, from, to, holding, reportRequest]);

  React.useEffect(() => {
    void load();
  }, [load]);

  /*
   * A count sets TODAY's figure. Offering it while looking at last Tuesday
   * would invite someone to "correct" a historic balance, which is not what a
   * count does - so it is only offered on the live view.
   */
  const viewingToday = !to || to >= todayISO();
  const canCount = viewingToday && (role ? canWrite({ role }, "production") : false);

  const historyRequest = useLatestRequest();
  const openRow = React.useCallback(
    async (row: ReportRow, options?: { keepHistory?: boolean }) => {
      const ticket = historyRequest.next();
      setSelected(row);
      // A background refresh keeps the trail on screen while it reloads,
      // rather than blanking it for a moment every time another tab saves
      if (!options?.keepHistory) {
        setHistory([]);
        setHistoryLoading(true);
      }
      try {
        const params = new URLSearchParams({ partId: row.id });
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const res = await fetch(`/api/parts/stages/history?${params}`);
        const data = await res.json();
        if (!historyRequest.isLatest(ticket)) return;
        if (data.success) {
          setHistory(data.data);
          setHistoryTruncated(Boolean(data.truncated));
        }
      } catch {
        // The flow still shows; only the trail below it is missing
      } finally {
        if (historyRequest.isLatest(ticket)) setHistoryLoading(false);
      }
    },
    [from, to, historyRequest]
  );

  /*
   * Reload when something may have changed elsewhere: a fettling entry saved
   * in another tab, a batch completed, or this tab coming back into view
   * (including Back, which reuses the page as it was left).
   *
   * An open flow view is refreshed too - it is a snapshot of one row, and
   * leaving it showing the old counts is the exact complaint this fixes.
   */
  const selectedRef = React.useRef<ReportRow | null>(null);
  React.useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const refreshEverything = React.useCallback(async () => {
    await load();
    const open = selectedRef.current;
    if (!open) return;
    const params = new URLSearchParams({ page: "1", pageSize: "100", search: open.partCode });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    try {
      const fresh = await (await fetch(`/api/parts/stages/report?${params}`)).json();
      const updated = (fresh.data as ReportRow[] | undefined)?.find((r) => r.id === open.id);
      // Only if the same part is still open - the user may have closed it or
      // opened another while this was loading
      if (updated && selectedRef.current?.id === open.id) {
        await openRow(updated, { keepHistory: true });
      }
    } catch {
      // The table refreshed; the open view keeps its last figures
    }
  }, [load, from, to, openRow]);

  useRefreshOnChange(refreshEverything);

  const quantityAt = (row: ReportRow, stageKey: string) =>
    row.stages.find((s) => s.stageKey === stageKey)?.quantity ?? 0;

  const openCount = (row: ReportRow, stageKey: string, place: string) => {
    const current = quantityAt(row, stageKey);
    setCounting({ partId: row.id, partCode: row.partCode, stageKey, place, current });
    setCountValue(String(current));
    setCountNote("");
    setCountError("");
  };

  const saveCount = async () => {
    if (!counting) return;
    setIsSaving(true);
    setCountError("");
    try {
      const res = await fetch("/api/parts/stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partId: counting.partId,
          stageKey: counting.stageKey,
          quantity: parseInt(countValue) || 0,
          notes: countNote,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setCountError(data.error || "Could not save that count");
        return;
      }
      setCounting(null);
      await refreshEverything();
      announcePiecesChanged();
    } catch {
      setCountError("Could not save that count");
    } finally {
      setIsSaving(false);
    }
  };

  const filtersActive =
    search.trim() !== "" || holding !== "" || from !== monthStartISO() || to !== todayISO();

  const clearFilters = () => {
    setSearch("");
    setHolding("");
    setFrom(monthStartISO());
    setTo(todayISO());
    setPage(1);
  };

  // The flow for the selected part, as of the end of the chosen period
  const flow = React.useMemo(() => {
    if (!selected) return { nodes: [] as Node[], edges: [] as Edge[] };
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const x = (i: number) => i * (NODE_WIDTH + NODE_GAP);

    nodes.push({
      id: "start",
      type: "terminal",
      position: { x: x(0), y: 20 },
      data: { label: "Cast in", value: selected.castIn, hint: "Entered the route this period", kind: "start" },
      draggable: false,
      selectable: false,
    });

    selected.routeSteps.forEach((step, index) => {
      const key = `STEP:${step.id}`;
      nodes.push({
        id: step.id,
        type: "station",
        position: { x: x(index + 1), y: 10 },
        data: {
          label: step.activityType.name,
          position: step.sequence,
          waiting: quantityAt(selected, key),
          rework: quantityAt(selected, `REWORK:${step.id}`),
          countable: canCount,
          onCount: () => openCount(selected, key, step.activityType.name),
        },
        draggable: false,
        selectable: false,
      });
      edges.push({
        id: `e${index}`,
        source: index === 0 ? "start" : selected.routeSteps[index - 1].id,
        target: step.id,
        animated: quantityAt(selected, key) > 0,
      });
    });

    nodes.push({
      id: "end",
      type: "terminal",
      position: { x: x(selected.routeSteps.length + 1), y: 20 },
      data: {
        label: "Ready",
        value: selected.ready,
        hint: "Finished stock",
        kind: "end",
        countable: canCount,
        onCount: () => openCount(selected, "READY", "finished stock"),
      },
      draggable: false,
      selectable: false,
    });
    edges.push({
      id: "e-end",
      source: selected.routeSteps.length
        ? selected.routeSteps[selected.routeSteps.length - 1].id
        : "start",
      target: "end",
    });

    return { nodes, edges };
    // openCount/quantityAt close over `selected`, which is a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, canCount]);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const asOfLabel = viewingToday ? "now" : `end of ${to}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Shop Floor</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Where every part&apos;s pieces are standing, and what moved in the period.
          Each casting is counted once, wherever it has reached. Click a part to
          see its route.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--error)]/30 bg-red-50 p-3 text-sm text-[var(--error)]">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard title="In process" value={fmt(totals?.inProcess ?? 0)} icon={Factory} iconClassName="bg-blue-100" description={`Waiting at a station, ${asOfLabel}`} />
        <StatCard title="For repair" value={fmt(totals?.inRework ?? 0)} icon={Wrench} iconClassName="bg-amber-100" description={`On the repair bench, ${asOfLabel}`} />
        <StatCard title="Finished" value={fmt(totals?.ready ?? 0)} icon={PackageCheck} iconClassName="bg-green-100" description={`Ready stock, ${asOfLabel}`} />
        <StatCard title="Cast in" value={fmt(totals?.castIn ?? 0)} icon={Flame} iconClassName="bg-orange-100" description="Entered the route in the period" />
        <StatCard title="Completed" value={fmt(totals?.finished ?? 0)} icon={PackageCheck} iconClassName="bg-green-100" description="Reached Ready in the period" />
        <StatCard title="Melted" value={fmt(totals?.melted ?? 0)} icon={Recycle} iconClassName="bg-red-100" description="Rejected to the furnace in the period" />
      </div>

      <Card>
        <CardContent className="pt-6">
          {/* Filters */}
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                Part
              </span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search by code or name"
                  className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 text-sm text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--primary)]/30"
                />
              </div>
            </div>
            <Input
              label="From"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
            <Input
              label="To"
              type="date"
              value={to}
              min={from || undefined}
              max={todayISO()}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
            <Select
              label="Showing"
              options={[
                { value: "", label: "All parts" },
                { value: "process", label: "With pieces in process" },
                { value: "rework", label: "With pieces for repair" },
                { value: "ready", label: "With finished stock" },
              ]}
              value={holding}
              onChange={(value) => {
                setHolding(value);
                setPage(1);
              }}
            />
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
            <span>
              Counts on the floor are as of <span className="font-medium">{asOfLabel}</span>
              {from || to ? (
                <>
                  ; movement columns cover{" "}
                  <span className="font-medium">
                    {from || "the start"} to {to || "today"}
                  </span>
                </>
              ) : null}
              .{isRefreshing && " Updating..."}
            </span>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex cursor-pointer items-center gap-1 text-[var(--primary)] hover:underline"
              >
                <X className="h-3 w-3" />
                Reset filters
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No parts to show"
              description={
                filtersActive
                  ? "Nothing matches these filters. Try a wider date range or clear the search."
                  : "Parts appear here once they have a route. Set routes on the Parts page, then complete a batch or count what is already on the floor."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-4 py-3 text-left text-sm font-semibold">Part</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Route</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">In process</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">For repair</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Ready</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Most waiting at</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Cast in</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Completed</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Melted</th>
                    <th className="px-4 py-3" aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => void openRow(row)}
                      className="cursor-pointer border-b border-[var(--border)] hover:bg-[var(--muted)]"
                    >
                      <td className="px-4 py-3">
                        <span className="rounded bg-[var(--muted)] px-2 py-1 font-mono text-sm">
                          {row.partCode}
                        </span>
                        <p className="mt-1 text-sm font-medium">{row.name}</p>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {row.routeSteps.length > 0 ? (
                          <span title={row.routeSteps.map((s) => s.activityType.name).join(" -> ")}>
                            {row.routeSteps.length} step{row.routeSteps.length === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <span className="text-amber-700">Not set</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">
                        {row.inProcess > 0 ? fmt(row.inProcess) : <span className="text-[var(--muted-foreground)]">0</span>}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {row.inRework > 0 ? (
                          <span className="font-medium text-amber-700">{fmt(row.inRework)}</span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {row.ready > 0 ? (
                          <span className="font-medium text-green-700">{fmt(row.ready)}</span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {row.bottleneck ? (
                          <>
                            {row.bottleneck.name}
                            <span className="ml-1 text-xs text-[var(--muted-foreground)]">
                              ({fmt(row.bottleneck.quantity)})
                            </span>
                          </>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">&mdash;</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">{fmt(row.castIn)}</td>
                      <td className="px-4 py-3 text-sm">{fmt(row.finished)}</td>
                      <td className="px-4 py-3 text-sm">
                        {row.melted > 0 ? (
                          <span className="text-[var(--error)]">{fmt(row.melted)}</span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--muted-foreground)]">
                        <ChevronRight className="h-4 w-4" />
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

      {/* One part's detail, centred.
          Sized to the content rather than the window: wide enough for the
          route and the movement list, narrow enough that it does not swallow
          the screen the way the full-width version did. */}
      <Modal
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? selected.name : ""}
        description={selected ? `Part number ${selected.partCode}` : ""}
        size="xl"
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>
                <span className="text-[var(--muted-foreground)]">On the floor ({asOfLabel}): </span>
                <span className="font-medium">{fmt(selected.onFloor)}</span>
              </span>
              <span>
                <span className="text-[var(--muted-foreground)]">Ready: </span>
                <span className="font-medium text-green-700">{fmt(selected.ready)}</span>
              </span>
              <span>
                <span className="text-[var(--muted-foreground)]">Melted in period: </span>
                <span className="font-medium text-[var(--error)]">{fmt(selected.melted)}</span>
              </span>
              {selected.counted !== 0 && (
                <span>
                  <span className="text-[var(--muted-foreground)]">Count corrections: </span>
                  <span className="font-medium">
                    {selected.counted > 0 ? "+" : ""}
                    {fmt(selected.counted)}
                  </span>
                </span>
              )}
            </div>

            {selected.routeSteps.length === 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                This part has no route, so its castings go straight to finished
                stock. Set its route on the Parts page to track it station by
                station.
              </p>
            ) : (
              <div
                className="rounded-lg border border-[var(--border)] bg-[var(--muted)]"
                style={{ height: 300 }}
              >
                <ReactFlow
                  nodes={flow.nodes}
                  edges={flow.edges}
                  nodeTypes={nodeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.12, minZoom: 0.35, maxZoom: 1 }}
                  /* The route runs off the edge for a part with many
                     stations, so the canvas pans and zooms to reach the rest
                     of it. The nodes themselves stay where they are put. */
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  panOnDrag
                  zoomOnScroll={false}
                  zoomOnPinch
                  zoomOnDoubleClick={false}
                  // The wheel scrolls the dialog; the canvas is moved by dragging
          preventScrolling={false}
                  minZoom={0.2}
                  maxZoom={1.5}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background variant={BackgroundVariant.Dots} gap={14} size={1} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </div>
            )}

            {/* The picture in numbers, between the diagram and the list of
                every movement. Six short cards answer what the floor actually
                asks - how many did we make, how many are done, how many went
                wrong, and did we save any - without reading a trail of
                entries to work it out. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                {
                  label: "Made",
                  value: selected.castIn ?? 0,
                  hint: "put into the shop",
                  tone: "text-[var(--foreground)]",
                },
                {
                  label: "Finished",
                  value: selected.finished ?? 0,
                  hint: "all steps done",
                  tone: "text-green-700",
                },
                {
                  label: "Still working",
                  value: selected.inProcess ?? 0,
                  hint: "at a station now",
                  tone: "text-blue-700",
                },
                {
                  label: "Sent for repair",
                  value: selected.sentToRepair ?? 0,
                  hint: "saved from the melt",
                  tone: "text-amber-700",
                },
                {
                  label: "Repaired",
                  value: selected.repaired ?? 0,
                  hint: "back in the line",
                  tone: "text-amber-700",
                },
                {
                  label: "Melted",
                  value: selected.melted ?? 0,
                  hint: "back to the furnace",
                  tone: "text-[var(--error)]",
                },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3"
                >
                  <p className={`text-xl font-semibold ${card.tone}`}>
                    {card.value.toLocaleString("en-IN")}
                  </p>
                  <p className="text-xs font-medium text-[var(--foreground)]">
                    {card.label}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {card.hint}
                  </p>
                </div>
              ))}
            </div>

            {!viewingToday && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Showing the floor as it stood at the end of {to}. Counting is only
                offered on today&apos;s view - a count sets the current figure.
              </p>
            )}

            <div>
              <h4 className="mb-2 text-sm font-semibold text-[var(--foreground)]">
                Movements in the period
              </h4>
              {historyLoading ? (
                <div className="flex justify-center py-6">
                  <LoadingSpinner />
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">
                  Nothing moved for this part in the period.
                </p>
              ) : (
                /* No scrollbar of its own: a short list inside a scrolling
                   dialog gave two nested scrollbars and showed four rows at a
                   time. The whole history runs down the popup, which scrolls,
                   and the header sticks to the top of it on the way. */
                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10 bg-[var(--card)]">
                      <tr className="border-b border-[var(--border)]">
                        <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold">When</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold">Where</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold">Change</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold">Balance</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold">Why</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.id} className="border-b border-[var(--border)] last:border-0">
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted-foreground)]">
                            {new Date(h.at).toLocaleString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs">{h.place}</td>
                          <td
                            className={`px-3 py-2 text-xs font-semibold ${
                              h.change > 0 ? "text-green-700" : "text-[var(--error)]"
                            }`}
                          >
                            {h.change > 0 ? "+" : ""}
                            {h.change}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted-foreground)]">
                            {h.before} &rarr; {h.after}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs">
                            <span className="font-medium">{h.source}</span>
                            {h.notes && (
                              <span className="ml-1 text-[var(--muted-foreground)]">
                                &middot; {h.notes}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted-foreground)]">{h.by}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {historyTruncated && (
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Showing the latest 300 movements. Narrow the dates to see earlier ones.
                </p>
              )}
            </div>
          </div>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      {/* Stock-take */}
      <Modal
        isOpen={counting !== null}
        onClose={() => setCounting(null)}
        title="Count what is there"
        size="sm"
      >
        {counting && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted-foreground)]">
              Pieces of{" "}
              <span className="font-medium text-[var(--foreground)]">{counting.partCode}</span>{" "}
              physically at{" "}
              <span className="font-medium text-[var(--foreground)]">{counting.place}</span>.
              The system currently says {counting.current}.
            </p>
            {countError && (
              <div className="rounded-lg border border-[var(--error)]/30 bg-red-50 p-2 text-sm text-[var(--error)]">
                {countError}
              </div>
            )}
            <Input
              label="Counted"
              type="number"
              min="0"
              value={countValue}
              onChange={(e) => setCountValue(e.target.value)}
              className="h-12"
            />
            <Input
              label="Why (optional)"
              placeholder="Opening count, recount after a spill..."
              value={countNote}
              onChange={(e) => setCountNote(e.target.value)}
              className="h-12"
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              This sets the figure outright and is recorded as a count in the
              history - never mistaken for work somebody did.
            </p>
          </div>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setCounting(null)}>
            Cancel
          </Button>
          <Button onClick={saveCount} isLoading={isSaving}>
            Save count
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
