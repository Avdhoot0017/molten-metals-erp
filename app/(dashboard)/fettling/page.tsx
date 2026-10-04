"use client";

import * as React from "react";
import {
  ClipboardList,
  Loader2,
  Lock,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Package,
  Users,
  Plus,
  Eye,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";
/** The form's way of saying "all of this part's repair piles at once". */
const COMBINED_REPAIR = "REWORK:ALL";
import {
  announcePiecesChanged,
  useRefreshOnChange,
  useLatestRequest,
} from "@/lib/live-updates";
import {
  parseWeightInput,
  weightToInput,
  formatWeight,
  WEIGHT_UNIT,
} from "@/lib/units";
import { canWrite } from "@/lib/permissions";
import type { ActivityType, UserRole } from "@/types";

interface PartRef {
  id: string;
  name: string;
  partCode: string;
  /** Grams. Used to work out what rejects weigh when nobody weighed them. */
  weightPerPiece: number;
  /** The stations this part passes through, in order. */
  routeSteps?: Array<{
    id: string;
    sequence: number;
    activityTypeId: string;
    activityType: { id: string; name: string };
  }>;
}

interface ActivityItem {
  id: string;
  partId: string;
  partsCompleted: number;
  partsRejected: number;
  /** Weighed scrap in grams; null where the calculation was left to stand. */
  rejectedWeight: number | null;
  routeStepId: string | null;
  reworkQty: number;
  reworkFromStepId: string | null;
  returnStepId: string | null;
  part: PartRef;
}

/** One employee's row for the chosen day - recorded or not. */
interface DayRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  activityTypeId: string;
  activityTypeName: string;
  recordedActivityTypeId: string;
  recordedActivityName: string;
  partsCompleted: number | null;
  partsRejected: number | null;
  notes: string;
  activityId: string | null;
  /** When it was written up - newest first in the recorded list. */
  recordedAt?: string | null;
  recordedBy: string | null;
  items: ActivityItem[];
}

interface DaySheet {
  date: string;
  isToday: boolean;
  editable: boolean;
  rows: DayRow[];
  totalParts: number;
  totalRejected: number;
  totalAccepted: number;
  filledCount: number;
}

/** A part line being edited in the popup, held as strings like every form. */
interface DraftLine {
  /**
   * Identifies this line, because a part is no longer unique in the list.
   *
   * Reopening a welder's day shows one line per pile they repaired, and
   * editing by part id would have changed both at once.
   */
  key: string;
  partId: string;
  partsCompleted: string;
  partsRejected: string;
  /** Weighed scrap in kg as typed. Blank means "use the calculation". */
  rejectedWeight: string;
  /**
   * Which queue this work draws from: "STEP:<id>" for the route, or
   * "REWORK:<id>" for repairing what a station rejected.
   */
  source: string;
  /** Of the rejects, how many are worth repairing rather than melting. */
  reworkQty: string;
  /** Where repaired pieces rejoin the route. Blank means "where they failed". */
  returnTo: string;
}

/** Today's date as YYYY-MM-DD in the browser's timezone. */
function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function FettlingPage() {
  const [date, setDate] = React.useState(todayISO());
  const [sheet, setSheet] = React.useState<DaySheet | null>(null);
  const [role, setRole] = React.useState<UserRole | null>(null);
  const [activityTypes, setActivityTypes] = React.useState<ActivityType[]>([]);
  /**
   * How many pieces of each part are standing at each station.
   *
   * Shown against every line so the operator sees the queue before typing into
   * it. The entry is refused if it exceeds what is there, and a refusal nobody
   * could have seen coming is just an obstacle.
   */
  const [stages, setStages] = React.useState<
    Array<{
      partId: string;
      stageKey: string;
      quantity: number;
      kind: string;
      /** When this queue last changed - "waiting since" without a ledger replay. */
      lastUpdated?: string;
      routeStep: {
        sequence: number;
        activityTypeId: string;
        activityType: { id: string; name: string };
      } | null;
    }>
  >([]);
  const [parts, setParts] = React.useState<PartRef[]>([]);

  const [isPageLoading, setIsPageLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Which employee's entry is open, and in which mode
  const [editing, setEditing] = React.useState<DayRow | null>(null);
  const [viewing, setViewing] = React.useState<DayRow | null>(null);
  const [removing, setRemoving] = React.useState<DayRow | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const [formActivityTypeId, setFormActivityTypeId] = React.useState("");
  /** Pieces the entry being edited already took, per part and queue. */
  const [ownTaken, setOwnTaken] = React.useState<Map<string, number>>(new Map());
  /**
   * Part lines where the operator set the repair/melt split themselves.
   *
   * Everything else follows the rejected count: a casting that just failed is
   * a candidate for the welding bench until somebody says otherwise, and
   * melting it is the decision that cannot be taken back.
   */
  const [manualRework, setManualRework] = React.useState<Set<string>>(new Set());
  const [formNotes, setFormNotes] = React.useState("");
  const [lines, setLines] = React.useState<DraftLine[]>([]);
  const [partToAdd, setPartToAdd] = React.useState("");

  const canManage = role ? canWrite({ role }, "fettling") : false;
  const editable = (sheet?.editable ?? false) && canManage;

  const sheetRequest = useLatestRequest();
  const loadSheet = React.useCallback(
    async (targetDate: string) => {
      // Flicking between days quickly sends several requests; only the last
      // one asked for may land, or an older day's figures reappear
      const ticket = sheetRequest.next();
      const res = await fetch(`/api/fettling/daily?date=${targetDate}`);
      const result = await res.json();
      if (!sheetRequest.isLatest(ticket)) return;
      if (result.success) {
        setSheet(result.data);
        setError(null);
      } else {
        setError(result.error || "Failed to load the day");
      }
    },
    [sheetRequest]
  );

  /**
   * The station queues and part routes - everything the "N waiting" badges
   * and the queue choices are built from.
   *
   * Used to be read once when the page opened, so after Ganesh's riser
   * cutting was saved, Mohan's belt-sander line still said "none waiting"
   * until the page was refreshed. It is now reloaded after every save and
   * delete, whenever an entry is opened, and when anything changes elsewhere.
   */
  const flowRequest = useLatestRequest();
  const loadFlow = React.useCallback(async () => {
    const ticket = flowRequest.next();
    try {
      const [partsRes, stagesRes] = await Promise.all([
        fetch("/api/parts"),
        fetch("/api/parts/stages"),
      ]);
      const partsData = await partsRes.json();
      const stagesData = await stagesRes.json();
      if (!flowRequest.isLatest(ticket)) return;
      if (stagesData.success) setStages(stagesData.data || []);
      if (partsData.success) {
        const list = Array.isArray(partsData.data)
          ? partsData.data
          : partsData.data?.parts ?? [];
        setParts(list);
      }
    } catch {
      // The badges keep their last figures; the server still refuses an
      // entry that exceeds the real queue
    }
  }, [flowRequest]);

  const refreshAll = React.useCallback(async () => {
    await Promise.all([loadSheet(date), loadFlow()]);
  }, [date, loadSheet, loadFlow]);

  // Another tab saved something, or this one came back into view
  useRefreshOnChange(refreshAll);

  React.useEffect(() => {
    void (async () => {
      try {
        const [sessionRes, typesRes] = await Promise.all([
          fetch("/api/auth/session"),
          fetch("/api/activity-types"),
          loadFlow(),
        ]);
        const sessionData = await sessionRes.json();
        const typesData = await typesRes.json();
        if (sessionData.success) setRole(sessionData.user.role);
        if (typesData.success) setActivityTypes(typesData.data || []);
      } catch {
        // These only decide what the form offers; the API validates regardless
      }
    })();
  }, [loadFlow]);

  React.useEffect(() => {
    void (async () => {
      setIsPageLoading(true);
      try {
        await loadSheet(date);
      } catch (err) {
        console.error("Error loading the day:", err);
        setError("Failed to load the day");
      } finally {
        setIsPageLoading(false);
      }
    })();
  }, [date, loadSheet]);

  const operationOptions = activityTypes.map((t) => ({
    value: t.id,
    label: t.name,
  }));

  const partOptions = parts.map((p) => ({
    value: p.id,
    label: `${p.partCode} - ${p.name}`,
  }));

  // A part already on the list should not be offered again
  const availablePartOptions = partOptions.filter(
    (o) => !lines.some((l) => l.partId === o.value)
  );

  /*
   * Newest entry at the top.
   *
   * The sheet is built employee by employee, so a day's entries came out in
   * staff order - the one just saved could appear anywhere in the list, and
   * the person who wrote it had to go hunting to check it.
   */
  const recorded = [...(sheet?.rows.filter((r) => r.activityId) ?? [])].sort(
    (a, b) =>
      new Date(b.recordedAt ?? 0).getTime() -
      new Date(a.recordedAt ?? 0).getTime()
  );
  const pending = sheet?.rows.filter((r) => !r.activityId) ?? [];

  /** Pieces standing in one queue right now. */
  const queueSize = React.useCallback(
    (partId: string, stageKey: string) =>
      stages.find((s) => s.partId === partId && s.stageKey === stageKey)
        ?.quantity ?? 0,
    [stages]
  );

  /**
   * What an entry can draw from a queue: what is there now, plus whatever the
   * entry being edited already took from it. Without the second part, re-
   * opening a saved entry shows its own station empty.
   */
  const availableIn = React.useCallback(
    (partId: string, stageKey: string) =>
      queueSize(partId, stageKey) + (ownTaken.get(`${partId}|${stageKey}`) ?? 0),
    [queueSize, ownTaken]
  );

  /**
   * The queues this employee could be working from, for one part.
   *
   * The process decides which kind of work this is, and the two kinds are
   * never mixed:
   *
   *   on the part's route  -> that station's own queue, and nothing else.
   *                           Fettling does fettling; it is not offered other
   *                           benches' reject piles.
   *   not on the route     -> a repair bench. Only reject piles, never route
   *                           work, because the part does not pass through
   *                           this station on its way through the shop.
   *
   * Offering both at once was how a fettler ended up looking at welding's
   * repair piles in a list they had no business choosing from.
   */
  /**
   * A part's reject piles, biggest question first: which bench turned them
   * down, and how many. Route order, because that is the order they are
   * worked through.
   */
  const pilesFor = React.useCallback(
    (partId: string) =>
      (parts.find((p) => p.id === partId)?.routeSteps ?? [])
        .map((step) => ({
          step,
          available: availableIn(partId, `REWORK:${step.id}`),
        }))
        .filter((pile) => pile.available > 0),
    [parts, availableIn]
  );

  /**
   * A short line about the queue at this station: where the pieces came from
   * and when they last moved.
   *
   * "7 waiting" alone says nothing about whether they arrived this morning or
   * have been sitting there a fortnight, and the bench before this one is the
   * first place to ask when a queue is not moving.
   */
  const queueNoteFor = React.useCallback(
    (partId: string, stageKey: string) => {
      const stage = stages.find(
        (s) => s.partId === partId && s.stageKey === stageKey
      );
      if (!stage || stage.quantity <= 0) return null;

      const route = parts.find((p) => p.id === partId)?.routeSteps ?? [];
      const here = route.findIndex(
        (r) => r.sequence === stage.routeStep?.sequence
      );
      const cameFrom =
        here <= 0
          ? "cast at the furnace"
          : `${route[here - 1].activityType.name}`;

      const when = stage.lastUpdated
        ? new Date(stage.lastUpdated).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
          })
        : null;

      return `From ${cameFrom}${when ? ` - last moved ${when}` : ""}`;
    },
    [stages, parts]
  );

  const sourcesFor = React.useCallback(
    (partId: string) => {
      const route = parts.find((p) => p.id === partId)?.routeSteps ?? [];
      const options: Array<{ value: string; label: string; available: number }> = [];

      const own = route.find((r) => r.activityTypeId === formActivityTypeId);
      if (own) {
        // A station on the route works its own queue. An empty queue is still
        // the right answer - and the one an edited entry emptied has to stay
        // selectable, or that entry could not be reopened.
        const key = `STEP:${own.id}`;
        const available = availableIn(partId, key);
        options.push({
          value: key,
          label: `${own.activityType.name} queue - ${available} waiting`,
          available,
        });
        return options;
      }

      /*
       * A repair bench gets ONE line for the part, not one per pile.
       *
       * A welder is handed a tray of rejects; which bench turned each one down
       * is on the ledger, not on the casting. Splitting the count across piles
       * before the day could be recorded was bookkeeping pushed onto the shop
       * floor - and with two piles, one employee could not be given both.
       * They enter one figure and the server divides it, earliest station
       * first, so the breakdown still comes out right.
       */
      const piles = pilesFor(partId);

      if (piles.length > 0) {
        const total = piles.reduce((sum, p) => sum + p.available, 0);
        options.push({
          value: COMBINED_REPAIR,
          label: `Repair - ${total} waiting (${piles
            .map((p) => `${p.available} from ${p.step.activityType.name}`)
            .join(", ")})`,
          available: total,
        });
      }

      return options;
    },
    [parts, formActivityTypeId, availableIn, pilesFor]
  );

  /*
   * Keep each line pointed at a queue the chosen process can actually work.
   *
   * A line's queue is picked when the part is added. Switching the process
   * afterwards used to leave route lines drawing from the OLD station, and a
   * repair line pointed at a reject pile even once the process had become a
   * station on the route - which that process cannot touch. Anything the new
   * process does not offer is re-pointed at what it does.
   */
  React.useEffect(() => {
    setLines((current) => {
      let changed = false;
      const next = current.map((line) => {
        const options = sourcesFor(line.partId);
        // A repair line stays put as long as the bench can still work that
        // pile - which pile a welder is on does not depend on the process name
        if (options.some((o) => o.value === line.source)) return line;
        const resolved = options[0]?.value ?? "";
        if (resolved === line.source) return line;
        changed = true;
        return { ...line, source: resolved, returnTo: "" };
      });
      return changed ? next : current;
    });
    // Re-resolve on a process change (or once routes load), not on every
    // count update - a queue's size does not change which queue it is
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formActivityTypeId, parts]);

  /**
   * Where a repaired piece can rejoin: any station on the part's route.
   *
   * A weld can undo work that has to be redone, or leave the casting ready for
   * a later stage - the bench decides, so every step is offered and the one
   * that rejected it is only the default.
   */
  const returnOptionsFor = React.useCallback(
    (partId: string, source: string) => {
      // Combined piles: each piece goes back to the bench that rejected it,
      // so there is no one answer to ask for
      if (source === COMBINED_REPAIR) return [];
      if (!source.startsWith("REWORK:")) return [];
      const stepId = source.slice("REWORK:".length);
      const part = parts.find((p) => p.id === partId);
      const route = part?.routeSteps ?? [];
      if (!route.some((r) => r.id === stepId)) return [];
      return route;
    },
    [parts]
  );

  const draftTotals = lines.reduce(
    (acc, l) => {
      const done = parseInt(l.partsCompleted) || 0;
      const rej = parseInt(l.partsRejected) || 0;
      return { done: acc.done + done, rejected: acc.rejected + rej };
    },
    { done: 0, rejected: 0 }
  );

  const openEntry = (row: DayRow) => {
    // Someone else may have moved pieces since the page loaded
    void loadFlow();
    /*
     * What this entry already took from each queue.
     *
     * The queues on screen are AFTER this entry was applied, so re-opening a
     * saved "10 done" would show the station empty and flag the line red -
     * though saving it unchanged moves nothing. Adding its own pieces back
     * gives the figure the operator is actually working against.
     */
    // A saved line already says how its rejects were split - that decision was
    // made at the bench and must not be restated by the default above
    setManualRework(
      new Set(row.items.filter((i) => i.partsRejected > 0).map((i) => i.partId))
    );
    setOwnTaken(
      new Map(
        row.items.map((i) => [
          `${i.partId}|${
            i.reworkFromStepId
              ? `REWORK:${i.reworkFromStepId}`
              : i.routeStepId
              ? `STEP:${i.routeStepId}`
              : ""
          }`,
          i.partsCompleted,
        ])
      )
    );
    setEditing(row);
    setFormError(null);
    setPartToAdd("");
    setFormActivityTypeId(row.recordedActivityTypeId || row.activityTypeId);
    setFormNotes(row.notes ?? "");
    setLines(
      row.items.map((i) => ({
        // A repaired part can appear once per pile, so the part id alone no
        // longer identifies a line
        key: `${i.partId}|${i.reworkFromStepId ?? i.routeStepId ?? ""}`,
        partId: i.partId,
        partsCompleted: String(i.partsCompleted),
        partsRejected: i.partsRejected ? String(i.partsRejected) : "",
        rejectedWeight:
          i.rejectedWeight === null ? "" : weightToInput(i.rejectedWeight),
        source: i.reworkFromStepId
          ? `REWORK:${i.reworkFromStepId}`
          : i.routeStepId
          ? `STEP:${i.routeStepId}`
          : "",
        reworkQty: i.reworkQty ? String(i.reworkQty) : "",
        returnTo: i.returnStepId ?? "",
      }))
    );
  };

  const closeEntry = () => {
    setOwnTaken(new Map());
    setManualRework(new Set());
    setEditing(null);
    setLines([]);
    setFormError(null);
  };

  const addLine = (partId: string) => {
    if (!partId) return;
    setLines((current) => [
      ...current,
      {
        key: `${partId}|${sourcesFor(partId)[0]?.value ?? "new"}`,
        partId,
        partsCompleted: "",
        partsRejected: "",
        rejectedWeight: "",
        // The station's own queue by default; repair work is the exception
        source: sourcesFor(partId)[0]?.value ?? "",
        reworkQty: "",
        returnTo: "",
      },
    ]);
    setPartToAdd("");
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((l) => (l.key === key ? { ...l, ...patch } : l))
    );
  };

  /*
   * Keep "send for repair" level with the rejected count until it is edited.
   *
   * Defaulting the other way - everything to the melt - meant a mis-typed
   * count melted castings that a weld could have saved, and the metal cannot
   * be uncast. Repair is the reversible default; the melt is one edit away.
   */
  React.useEffect(() => {
    setLines((current) => {
      let changed = false;
      const next = current.map((line) => {
        if (manualRework.has(line.partId)) return line;
        // A repair line's own failures go to the melt - a piece that could not
        // be saved at the bench does not go back to it
        if (line.source.startsWith("REWORK:")) return line;
        const rejected = parseInt(line.partsRejected) || 0;
        const wanted = rejected > 0 ? String(rejected) : "";
        if (wanted === line.reworkQty) return line;
        changed = true;
        return { ...line, reworkQty: wanted };
      });
      return changed ? next : current;
    });
  }, [lines, manualRework]);

  const removeLine = (key: string) => {
    setLines((current) => current.filter((l) => l.key !== key));
  };

  const handleSave = async () => {
    if (!editing) return;

    if (lines.length === 0) {
      setFormError("Add at least one part");
      return;
    }
    for (const line of lines) {
      const done = parseInt(line.partsCompleted) || 0;
      const rej = parseInt(line.partsRejected) || 0;
      const part = parts.find((p) => p.id === line.partId);
      if (done <= 0) {
        setFormError(`Enter the parts done for ${part?.partCode ?? "each part"}`);
        return;
      }
      if (rej > done) {
        setFormError(
          `Rejected cannot exceed parts done for ${part?.partCode ?? "a part"}`
        );
        return;
      }
      /*
       * Melted pieces are stock being created, so they are weighed.
       *
       * Falling back to count x nominal weight was fine while this was only a
       * figure on a report; it is inventory now, and a reject is often a
       * part-filled pour or already broken up.
       */
      const melting = Math.max(0, rej - (parseInt(line.reworkQty) || 0));
      if (melting > 0 && line.rejectedWeight.trim() === "") {
        setFormError(
          `Weigh the ${melting} piece${melting === 1 ? "" : "s"} of ${part?.partCode ?? "that part"} going to the melt - that weight is what goes into stock`
        );
        return;
      }
    }

    setIsSaving(true);
    setFormError(null);

    const payload = {
      employeeId: editing.employeeId,
      activityTypeId: formActivityTypeId,
      date,
      notes: formNotes,
      items: lines.map((l) => ({
        partId: l.partId,
        partsCompleted: parseInt(l.partsCompleted) || 0,
        partsRejected: parseInt(l.partsRejected) || 0,
        // Blank is sent as null, which tells the API to keep using the count
        // times the part weight rather than booking nothing
        rejectedWeight:
          l.rejectedWeight.trim() === ""
            ? null
            : parseWeightInput(l.rejectedWeight),
        source: l.source || null,
        reworkQty: parseInt(l.reworkQty) || 0,
        returnTo: l.returnTo || null,
      })),
    };

    try {
      // A row that already has an entry is edited; a fresh one is created
      const res = await fetch("/api/fettling", {
        method: editing.activityId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing.activityId ? { ...payload, id: editing.activityId } : payload
        ),
      });
      const result = await res.json();
      if (result.success) {
        // The sheet AND the queues - saving moved pieces between stations
        await refreshAll();
        announcePiecesChanged();
        closeEntry();
      } else {
        setFormError(result.error || "Failed to save");
      }
    } catch {
      setFormError("Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!removing?.activityId) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/fettling?id=${removing.activityId}`, {
        method: "DELETE",
      });
      const result = await res.json();
      if (result.success) {
        await refreshAll();
        announcePiecesChanged();
      } else {
        setError(result.error || "Failed to remove the entry");
      }
    } catch {
      setError("Failed to remove the entry");
    } finally {
      setRemoving(null);
      setIsSaving(false);
    }
  };

  if (isPageLoading && !sheet) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Fettling Shop
          </h1>
          <p className="text-[var(--muted-foreground)]">
            What each employee finished, broken down by part
          </p>
        </div>

        {/* Day picker */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            title="Previous day"
            onClick={() => setDate(shiftDate(date, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value || todayISO())}
            className="w-44"
          />
          <Button
            variant="outline"
            size="icon"
            title="Next day"
            disabled={date >= todayISO()}
            onClick={() => setDate(shiftDate(date, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {date !== todayISO() && (
            <Button variant="ghost" size="sm" onClick={() => setDate(todayISO())}>
              Today
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--error)]/30 bg-red-50 p-3 text-sm text-[var(--error)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {sheet && !sheet.editable && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {/* Say which days ARE open, not just that this one is shut -
                otherwise the next click is another locked day */}
            This day is closed for editing. You can record today and
            yesterday; ask an admin to change anything older. What was
            recorded here is still visible.
          </span>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={sheet?.isToday ? "Today's Total" : "Day Total"}
          value={(sheet?.totalParts ?? 0).toLocaleString("en-IN")}
          icon={Package}
          description="parts handled"
        />
        <StatCard
          title="Accepted"
          value={(sheet?.totalAccepted ?? 0).toLocaleString("en-IN")}
          icon={CheckCircle2}
          iconClassName="bg-green-100"
          description={
            sheet && sheet.totalParts > 0
              ? `${((sheet.totalAccepted / sheet.totalParts) * 100).toFixed(1)}% of parts handled`
              : "parts passed inspection"
          }
        />
        <StatCard
          title="Rejected"
          value={(sheet?.totalRejected ?? 0).toLocaleString("en-IN")}
          icon={XCircle}
          iconClassName="bg-red-100"
          description={
            sheet && sheet.totalParts > 0
              ? `${((sheet.totalRejected / sheet.totalParts) * 100).toFixed(1)}% rejection rate`
              : "parts failed inspection"
          }
        />
        <StatCard
          title="Employees Recorded"
          value={`${recorded.length} / ${sheet?.rows.length ?? 0}`}
          icon={Users}
          description={formatDate(new Date(date))}
        />
      </div>

      {/* Recorded */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-[var(--primary)]" />
            Recorded ({recorded.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recorded.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Nothing recorded for this day"
              description={
                editable
                  ? "Pick an employee below to record what they finished."
                  : "No fettling work was entered for this day."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Employee
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Operation
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Parts
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Done
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Rejected
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Accepted
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recorded.map((row) => {
                    const done = row.partsCompleted ?? 0;
                    const rejected = row.partsRejected ?? 0;
                    return (
                      <tr
                        key={row.employeeId}
                        className="border-b border-[var(--border)] hover:bg-[var(--muted)]"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-xs">
                              {row.employeeCode}
                            </span>
                            <span className="font-medium">{row.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="info">{row.recordedActivityName}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {/* The part codes themselves, so the common question
                              - what did they work on - needs no extra click */}
                          <div className="flex flex-wrap gap-1">
                            {row.items.map((i) => (
                              <span
                                key={i.id}
                                title={`${i.part.name}: ${i.partsCompleted} done`}
                                className="rounded bg-[var(--accent)] px-1.5 py-0.5 font-mono text-xs text-[var(--primary-dark)]"
                              >
                                {i.part.partCode}
                              </span>
                            ))}
                            {row.items.length === 0 && (
                              <span className="text-sm text-[var(--muted-foreground)]">
                                no breakdown
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {done.toLocaleString("en-IN")}
                        </td>
                        <td
                          className={`px-4 py-3 ${
                            rejected > 0
                              ? "font-medium text-red-600"
                              : "text-[var(--muted-foreground)]"
                          }`}
                        >
                          {rejected.toLocaleString("en-IN")}
                        </td>
                        <td className="px-4 py-3 font-semibold text-green-700">
                          {(done - rejected).toLocaleString("en-IN")}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="View this entry"
                              className="-ml-3"
                              onClick={() => setViewing(row)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {editable && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Edit this entry"
                                  onClick={() => openEntry(row)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Remove this entry"
                                  onClick={() => setRemoving(row)}
                                >
                                  <Trash2 className="h-4 w-4 text-[var(--error)]" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Not yet recorded */}
      {editable && pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-[var(--muted-foreground)]" />
              Not recorded yet ({pending.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pending.map((row) => (
                <button
                  key={row.employeeId}
                  type="button"
                  onClick={() => openEntry(row)}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3 text-left transition-colors hover:border-[var(--primary)]/50 hover:bg-[var(--muted)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{row.name}</span>
                    <span className="block text-xs text-[var(--muted-foreground)]">
                      {row.employeeCode} &middot; {row.activityTypeName}
                    </span>
                  </span>
                  <Plus className="h-4 w-4 shrink-0 text-[var(--primary)]" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------ add / edit popup */}
      <Modal
        isOpen={editing !== null}
        onClose={closeEntry}
        title={editing?.activityId ? "Edit Entry" : "Record Fettling Work"}
        description={
          editing
            ? `${editing.name} (${editing.employeeCode}) - ${formatDate(new Date(date))}`
            : ""
        }
        size="lg"
      >
        <div className="space-y-5">
          <Select
            label="Operation"
            options={operationOptions}
            value={formActivityTypeId}
            onChange={setFormActivityTypeId}
            placeholder="Choose the operation worked"
            className="h-12"
          />

          {/* Parts worked - several per shift, so they are added as lines */}
          <div className="rounded-lg border border-[var(--primary)]/20 bg-[var(--accent)] p-4">
            <h4 className="mb-3 font-medium text-[var(--foreground)]">
              Parts Worked
            </h4>

            <Select
              label="Add a part"
              options={availablePartOptions}
              value={partToAdd}
              onChange={addLine}
              placeholder={
                availablePartOptions.length === 0
                  ? "All parts added"
                  : "Choose a part to add"
              }
              className="h-12"
            />

            {lines.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                No parts yet. Add at least one to record this day.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {lines.map((line) => {
                  const part = parts.find((p) => p.id === line.partId);
                  const done = parseInt(line.partsCompleted) || 0;
                  const rej = parseInt(line.partsRejected) || 0;
                  const over = rej > done;
                  const sources = sourcesFor(line.partId);
                  const chosen = sources.find((o) => o.value === line.source);
                  const isRepair = line.source.startsWith("REWORK:");
                  // However many are in whichever queue this draws from
                  // Edit-aware: includes what this entry already took
                  const waiting = chosen?.available ?? 0;
                  // The server refuses this; saying so here saves the trip
                  const overQueue = done > waiting;
                  const toRepair = parseInt(line.reworkQty) || 0;
                  const toMelt = Math.max(0, rej - toRepair);
                  const returnOptions = returnOptionsFor(line.partId, line.source);
                  // Only melted pieces are scrap metal - one on the repair
                  // bench is still a casting
                  const calculated = toMelt * (part?.weightPerPiece ?? 0);
                  // What whole castings would weigh. Offered as the placeholder
                  // so the operator sees the figure their entry replaces.

                  return (
                    <div
                      key={line.key}
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-xs">
                            {part?.partCode}
                          </span>
                          <span className="ml-2 text-sm font-medium">
                            {part?.name}
                          </span>
                          {/* The queue at this station. These are the same
                              pieces the previous station passed on - not new
                              ones, which is what used to get double counted. */}
                          <span
                            className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                              waiting > 0
                                ? "bg-blue-50 text-blue-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {waiting} waiting
                          </span>
                          {/* Where this queue came from and when it last
                              moved. "7 waiting" alone does not say whether
                              they arrived this morning or have been sitting
                              a fortnight, and the bench before this one is
                              the first place to ask when nothing is moving. */}
                          {!isRepair && queueNoteFor(line.partId, line.source) && (
                            <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                              {queueNoteFor(line.partId, line.source)}
                            </span>
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Remove this part"
                          onClick={() => removeLine(line.key)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Where the repair pieces came from, as a statement.
                          The breakdown used to ride on the queue dropdown's
                          label - and that dropdown is hidden when there is
                          only one choice, which is every welder's case now the
                          piles are combined. So "7 waiting" was all they saw,
                          with no way to know 4 failed at one bench and 3 at
                          another. Read-only: the split is the ledger's answer,
                          not something to type over. */}
                      {isRepair && pilesFor(line.partId).length > 0 && (
                        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                          <p className="text-xs font-medium text-amber-900">
                            These {pilesFor(line.partId).reduce((s, p) => s + p.available, 0)}{" "}
                            pieces were rejected at:
                          </p>
                          <ul className="mt-1 space-y-0.5">
                            {pilesFor(line.partId).map((pile) => (
                              <li
                                key={pile.step.id}
                                className="flex items-center justify-between text-xs text-amber-800"
                              >
                                <span>
                                  {pile.step.sequence}. {pile.step.activityType.name}
                                </span>
                                <span className="font-semibold">
                                  {pile.available}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-1.5 text-xs text-amber-800">
                            Whatever you save goes back to the bench it failed
                            at. Oldest station first.
                          </p>
                        </div>
                      )}

                      {/* Which queue this work draws from. Repair work comes
                          off another station's reject pile, not this one's
                          queue, so it has to be named rather than assumed. */}
                      {sources.length > 1 && (
                        <div className="mb-3">
                          <Select
                            label="Working on"
                            options={sources.map((o) => ({
                              value: o.value,
                              label: o.label,
                            }))}
                            value={line.source}
                            onChange={(value) =>
                              updateLine(line.key, {
                                source: value,
                                // The return step belongs to the old queue
                                returnTo: "",
                              })
                            }
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-3">
                        <Input
                          label="Done"
                          type="number"
                          min="0"
                          placeholder="0"
                          error={
                            overQueue
                              ? waiting === 0
                                ? "None waiting here"
                                : `Only ${waiting} waiting`
                              : undefined
                          }
                          value={line.partsCompleted}
                          onChange={(e) =>
                            updateLine(line.key, {
                              partsCompleted: e.target.value,
                            })
                          }
                        />
                        <Input
                          label="Rejected"
                          type="number"
                          min="0"
                          placeholder="0"
                          error={over ? "Over parts done" : undefined}
                          value={line.partsRejected}
                          onChange={(e) =>
                            updateLine(line.key, {
                              partsRejected: e.target.value,
                            })
                          }
                        />
                        {/* Accepted is shown, never typed - it is the
                            difference, so it cannot be entered wrong */}
                        <div>
                          <span className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                            Accepted
                          </span>
                          <div className="flex h-10 items-center rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 font-semibold text-green-700">
                            {Math.max(0, done - rej).toLocaleString("en-IN")}
                          </div>
                        </div>
                      </div>

                      {/* Rejected does not have to mean melted: a weld can
                          save a casting, and melting it would put good metal
                          back in the furnace for nothing. */}
                      {rej > 0 && !isRepair && (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                          <p className="mb-2 text-xs font-medium text-amber-900">
                            What happens to the {rej} rejected
                          </p>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <Input
                              label="Send for repair"
                              type="number"
                              min="0"
                              max={rej}
                              placeholder="0"
                              error={toRepair > rej ? "More than rejected" : undefined}
                              value={line.reworkQty}
                              onChange={(e) => {
                                setManualRework((m) => new Set(m).add(line.partId));
                                updateLine(line.key, { reworkQty: e.target.value });
                              }}
                            />
                            {/* Either side can be typed - some benches count
                                what they are saving, others count what they
                                are throwing. The two always add up to the
                                rejected count, so setting one sets the other. */}
                            <Input
                              label="To the melt"
                              type="number"
                              min="0"
                              max={rej}
                              placeholder="0"
                              value={String(toMelt)}
                              onChange={(e) => {
                                setManualRework((m) => new Set(m).add(line.partId));
                                const typed = parseInt(e.target.value);
                                const melt = Number.isFinite(typed)
                                  ? Math.min(Math.max(0, typed), rej)
                                  : 0;
                                updateLine(line.key, {
                                  reworkQty: String(rej - melt),
                                });
                              }}
                            />
                            {/* The weight that actually goes into rejected-part
                                stock. Required, not optional: this metal is
                                being added to inventory, and a count times a
                                nominal weight is not a stock figure - a reject
                                can be a part-filled pour or already broken up.
                                It sits next to the melt count because that is
                                the only thing it describes. */}
                            <div>
                              <Input
                                label={`Weight to melt (${WEIGHT_UNIT})`}
                                type="number"
                                min="0"
                                step="any"
                                disabled={toMelt === 0}
                                required={toMelt > 0}
                                placeholder={toMelt === 0 ? "-" : "0"}
                                error={
                                  toMelt > 0 && line.rejectedWeight.trim() === ""
                                    ? "Enter the weight"
                                    : undefined
                                }
                                value={line.rejectedWeight}
                                onChange={(e) =>
                                  updateLine(line.key, {
                                    rejectedWeight: e.target.value,
                                  })
                                }
                              />
                              {/* No figure is filled in here on purpose: this
                                  weight is added to scrap stock, and a number
                                  nobody weighed would be stock nobody has. */}
                              {/* One line under the box, about the box. It
                                  used to sit at the foot of the whole part
                                  card in a second colour, far from the field
                                  it described. */}
                              {/* What these pieces SHOULD weigh - fixed, from
                                  the count and the part. It used to echo back
                                  whatever was typed, so a slip of 15 instead
                                  of 10 just restated itself and there was
                                  nothing to notice. A real difference is
                                  allowed - that is why they are weighed - so
                                  it turns red rather than refusing. */}
                              {toMelt > 0 && (() => {
                                const typed = parseWeightInput(line.rejectedWeight);
                                const off =
                                  line.rejectedWeight.trim() !== "" &&
                                  Math.abs(typed - calculated) > 1;
                                return (
                                  <p
                                    className={`mt-1.5 text-sm ${
                                      off ? "text-[var(--error)]" : "text-amber-700"
                                    }`}
                                  >
                                    Adding {formatWeight(calculated)} of scrap to
                                    stock &mdash; {toMelt} x{" "}
                                    {formatWeight(part?.weightPerPiece ?? 0)}.
                                    {off && (
                                      <>
                                        {" "}
                                        You entered {formatWeight(typed)} -{" "}
                                        {formatWeight(Math.abs(typed - calculated))}{" "}
                                        {typed > calculated ? "more" : "less"}.
                                        Check it.
                                      </>
                                    )}
                                  </p>
                                );
                              })()}
                            </div>
                          </div>
                          <p className="mt-1.5 text-xs text-amber-800">
                            {toRepair > 0 && toMelt > 0
                              ? `${toRepair} wait for repair and can rejoin the route. The ${toMelt} melted are added to rejected-part stock at the weight above.`
                              : toRepair > 0
                              ? `All ${rej} wait for repair - nothing is melted, so no scrap is added to stock.`
                              : `All ${rej} go to the melt and are added to rejected-part stock at the weight above. That cannot be undone.`}
                          </p>
                        </div>
                      )}

                      {/* A piece that could not be saved at the bench goes to
                          the melt, and that metal is weighed like any other.
                          The weight field used to live inside the repair/melt
                          split above, which a repair line skips entirely - so
                          the form demanded a weight it never showed. There is
                          no split to make here: a failed repair has nowhere
                          left to go. */}
                      {isRepair && rej > 0 && (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                          <p className="mb-2 text-xs font-medium text-amber-900">
                            {rej} could not be saved and {rej === 1 ? "goes" : "go"}{" "}
                            to the melt
                          </p>
                          <div className="max-w-xs">
                            <Input
                              label={`Weight to melt (${WEIGHT_UNIT})`}
                              type="number"
                              min="0"
                              step="any"
                              required
                              placeholder="0"
                              error={
                                line.rejectedWeight.trim() === ""
                                  ? "Enter the weight"
                                  : undefined
                              }
                              value={line.rejectedWeight}
                              onChange={(e) =>
                                updateLine(line.key, {
                                  rejectedWeight: e.target.value,
                                })
                              }
                            />
                            {/* What they would weigh whole, as a guide only.
                                Not filled in: a casting that reached the
                                welding bench has already had metal cut off
                                it, and a failed repair often has more gone
                                again - the scale is the only honest answer,
                                but a figure to sanity-check against stops a
                                slipped decimal point going into stock. */}
                            {(() => {
                              const nominal = rej * (part?.weightPerPiece ?? 0);
                              const typed = parseWeightInput(line.rejectedWeight);
                              const off =
                                line.rejectedWeight.trim() !== "" &&
                                Math.abs(typed - nominal) > 1;
                              return (
                                <p
                                  className={`mt-1.5 text-sm ${
                                    off ? "text-[var(--error)]" : "text-amber-700"
                                  }`}
                                >
                                  Adding {formatWeight(nominal)} of scrap to stock
                                  &mdash; {rej} x{" "}
                                  {formatWeight(part?.weightPerPiece ?? 0)}.
                                  {off && (
                                    <>
                                      {" "}
                                      You entered {formatWeight(typed)} -{" "}
                                      {formatWeight(Math.abs(typed - nominal))}{" "}
                                      {typed > nominal ? "more" : "less"}. Check it.
                                    </>
                                  )}
                                </p>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Repaired pieces have to be put somewhere, and only
                          the bench knows where a welded casting picks up. */}
                      {isRepair && returnOptions.length > 0 && (
                        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                          <Select
                            label="Put repaired pieces into"
                            options={returnOptions.map((r) => ({
                              value: r.id,
                              label: `${r.sequence}. ${r.activityType.name}${
                                r.id === line.source.slice("REWORK:".length)
                                  ? " (where they failed)"
                                  : ""
                              }`,
                            }))}
                            value={
                              line.returnTo || line.source.slice("REWORK:".length)
                            }
                            onChange={(value) =>
                              updateLine(line.key, { returnTo: value })
                            }
                          />
                          <p className="mt-1.5 text-xs text-blue-800">
                            Any station on this part&apos;s route. Sending them
                            past the step that rejected them means that check is
                            not repeated.
                          </p>
                        </div>
                      )}

                    </div>
                  );
                })}

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--background)] px-3 py-2 text-sm">
                  <span className="font-medium">Day total</span>
                  <span className="flex items-center gap-4">
                    <span>{draftTotals.done.toLocaleString("en-IN")} done</span>
                    <span className="text-red-600">
                      {draftTotals.rejected.toLocaleString("en-IN")} rejected
                    </span>
                    <span className="font-semibold text-green-700">
                      {(draftTotals.done - draftTotals.rejected).toLocaleString(
                        "en-IN"
                      )}{" "}
                      accepted
                    </span>
                  </span>
                </div>
              </div>
            )}
          </div>

          <Input
            label="Notes (optional)"
            placeholder="Anything worth recording about this day"
            value={formNotes}
            onChange={(e) => setFormNotes(e.target.value)}
          />
        </div>

        <ModalFooter className="justify-between">
          <div className="min-w-0 flex-1 text-sm">
            {formError ? (
              <span className="flex items-center gap-2 text-[var(--error)]">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="truncate">{formError}</span>
              </span>
            ) : (
              <span className="text-[var(--muted-foreground)]">
                {lines.length === 0
                  ? "Add at least one part"
                  : `${lines.length} part${lines.length > 1 ? "s" : ""} · ${draftTotals.done} done`}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Button variant="secondary" onClick={closeEntry}>
              Cancel
            </Button>
            <Button onClick={handleSave} isLoading={isSaving}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {editing?.activityId ? "Save Changes" : "Record"}
            </Button>
          </div>
        </ModalFooter>
      </Modal>

      {/* ------------------------------------------------------- preview */}
      <Modal
        isOpen={viewing !== null}
        onClose={() => setViewing(null)}
        title="Fettling Entry"
        size="lg"
      >
        {viewing && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-[var(--border)] p-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-[var(--muted-foreground)]">Employee</p>
                <p className="mt-0.5 font-medium">{viewing.name}</p>
                <p className="font-mono text-xs text-[var(--muted-foreground)]">
                  {viewing.employeeCode}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted-foreground)]">Operation</p>
                <p className="mt-0.5 font-medium">
                  {viewing.recordedActivityName}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted-foreground)]">Date</p>
                <p className="mt-0.5 font-medium">{formatDate(new Date(date))}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Recorded by
                </p>
                <p className="mt-0.5 font-medium">{viewing.recordedBy ?? "-"}</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  <tr>
                    <th className="px-4 py-2 font-medium">Part</th>
                    <th className="px-4 py-2 font-medium">Done</th>
                    <th className="px-4 py-2 font-medium">Rejected</th>
                    <th className="px-4 py-2 font-medium">Accepted</th>
                  </tr>
                </thead>
                <tbody>
                  {viewing.items.map((i) => (
                    <tr key={i.id} className="border-t border-[var(--border)]">
                      <td className="px-4 py-2.5">
                        <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-xs">
                          {i.part.partCode}
                        </span>
                        <span className="ml-2">{i.part.name}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {i.partsCompleted}
                      </td>
                      <td
                        className={`px-4 py-2.5 ${
                          i.partsRejected > 0
                            ? "text-red-600"
                            : "text-[var(--muted-foreground)]"
                        }`}
                      >
                        {i.partsRejected}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-green-700">
                        {i.partsCompleted - i.partsRejected}
                      </td>
                    </tr>
                  ))}
                  {viewing.items.length === 0 && (
                    <tr className="border-t border-[var(--border)]">
                      <td
                        colSpan={4}
                        className="px-4 py-4 text-center text-[var(--muted-foreground)]"
                      >
                        Recorded before parts were tracked individually &mdash;
                        only the day&apos;s totals are known.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)] font-semibold">
                    <td className="px-4 py-2.5">Total</td>
                    <td className="px-4 py-2.5">
                      {viewing.partsCompleted ?? 0}
                    </td>
                    <td className="px-4 py-2.5 text-red-600">
                      {viewing.partsRejected ?? 0}
                    </td>
                    <td className="px-4 py-2.5 text-green-700">
                      {(viewing.partsCompleted ?? 0) -
                        (viewing.partsRejected ?? 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {viewing.notes && (
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  Notes
                </p>
                <p className="whitespace-pre-wrap rounded-lg bg-[var(--muted)] p-3 text-sm">
                  {viewing.notes}
                </p>
              </div>
            )}
          </div>
        )}

        <ModalFooter>
          <Button variant="secondary" onClick={() => setViewing(null)}>
            Close
          </Button>
          {viewing && editable && (
            <Button
              onClick={() => {
                const row = viewing;
                setViewing(null);
                openEntry(row);
              }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
          )}
        </ModalFooter>
      </Modal>

      {/* ------------------------------------------------- delete confirm */}
      <Modal
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this entry?"
        size="sm"
      >
        <p className="text-sm text-[var(--muted-foreground)]">
          {removing?.name}&apos;s work for {formatDate(new Date(date))} will be
          deleted, including the per-part breakdown. This cannot be undone.
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            isLoading={isSaving}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Remove
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
