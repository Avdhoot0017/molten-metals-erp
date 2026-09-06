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
import { canWrite } from "@/lib/permissions";
import type { ActivityType, UserRole } from "@/types";

interface PartRef {
  id: string;
  name: string;
  partCode: string;
}

interface ActivityItem {
  id: string;
  partId: string;
  partsCompleted: number;
  partsRejected: number;
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
  partId: string;
  partsCompleted: string;
  partsRejected: string;
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
  const [formNotes, setFormNotes] = React.useState("");
  const [lines, setLines] = React.useState<DraftLine[]>([]);
  const [partToAdd, setPartToAdd] = React.useState("");

  const canManage = role ? canWrite({ role }, "fettling") : false;
  const editable = (sheet?.editable ?? false) && canManage;

  const loadSheet = React.useCallback(async (targetDate: string) => {
    const res = await fetch(`/api/fettling/daily?date=${targetDate}`);
    const result = await res.json();
    if (result.success) {
      setSheet(result.data);
      setError(null);
    } else {
      setError(result.error || "Failed to load the day");
    }
  }, []);

  React.useEffect(() => {
    void (async () => {
      try {
        const [sessionRes, typesRes, partsRes] = await Promise.all([
          fetch("/api/auth/session"),
          fetch("/api/activity-types"),
          fetch("/api/parts"),
        ]);
        const sessionData = await sessionRes.json();
        const typesData = await typesRes.json();
        const partsData = await partsRes.json();
        if (sessionData.success) setRole(sessionData.user.role);
        if (typesData.success) setActivityTypes(typesData.data || []);
        if (partsData.success) {
          const list = Array.isArray(partsData.data)
            ? partsData.data
            : partsData.data?.parts ?? [];
          setParts(list);
        }
      } catch {
        // These only decide what the form offers; the API validates regardless
      }
    })();
  }, []);

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

  const recorded = sheet?.rows.filter((r) => r.activityId) ?? [];
  const pending = sheet?.rows.filter((r) => !r.activityId) ?? [];

  const draftTotals = lines.reduce(
    (acc, l) => {
      const done = parseInt(l.partsCompleted) || 0;
      const rej = parseInt(l.partsRejected) || 0;
      return { done: acc.done + done, rejected: acc.rejected + rej };
    },
    { done: 0, rejected: 0 }
  );

  const openEntry = (row: DayRow) => {
    setEditing(row);
    setFormError(null);
    setPartToAdd("");
    setFormActivityTypeId(row.recordedActivityTypeId || row.activityTypeId);
    setFormNotes(row.notes ?? "");
    setLines(
      row.items.map((i) => ({
        partId: i.partId,
        partsCompleted: String(i.partsCompleted),
        partsRejected: i.partsRejected ? String(i.partsRejected) : "",
      }))
    );
  };

  const closeEntry = () => {
    setEditing(null);
    setLines([]);
    setFormError(null);
  };

  const addLine = (partId: string) => {
    if (!partId) return;
    setLines((current) => [
      ...current,
      { partId, partsCompleted: "", partsRejected: "" },
    ]);
    setPartToAdd("");
  };

  const updateLine = (partId: string, patch: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((l) => (l.partId === partId ? { ...l, ...patch } : l))
    );
  };

  const removeLine = (partId: string) => {
    setLines((current) => current.filter((l) => l.partId !== partId));
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
        await loadSheet(date);
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
        await loadSheet(date);
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

                  return (
                    <div
                      key={line.partId}
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
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Remove this part"
                          onClick={() => removeLine(line.partId)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <Input
                          label="Done"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={line.partsCompleted}
                          onChange={(e) =>
                            updateLine(line.partId, {
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
                            updateLine(line.partId, {
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
