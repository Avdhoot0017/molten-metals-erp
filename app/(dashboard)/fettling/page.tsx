"use client";

import * as React from "react";
import {
  ClipboardList,
  Loader2,
  Save,
  Lock,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Package,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { formatDate } from "@/lib/utils";
import type { ActivityType, UserRole } from "@/types";

interface SheetRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  activityTypeId: string;
  activityTypeName: string;
  recordedActivityTypeId: string;
  recordedActivityName: string;
  partsCompleted: number | null;
  /** How many of those failed inspection. Null until the row is filled in. */
  partsRejected: number | null;
  notes: string;
  activityId: string | null;
  recordedBy: string | null;
}

interface Sheet {
  date: string;
  isToday: boolean;
  editable: boolean;
  rows: SheetRow[];
  totalParts: number;
  totalRejected: number;
  totalAccepted: number;
  filledCount: number;
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
  const [sheet, setSheet] = React.useState<Sheet | null>(null);
  const [draft, setDraft] = React.useState<SheetRow[]>([]);
  const [role, setRole] = React.useState<UserRole | null>(null);
  const [activityTypes, setActivityTypes] = React.useState<ActivityType[]>([]);

  const [isPageLoading, setIsPageLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);

  const loadSheet = React.useCallback(async (targetDate: string) => {
    const res = await fetch(`/api/fettling/daily?date=${targetDate}`);
    const result = await res.json();
    if (result.success) {
      setSheet(result.data);
      setDraft(result.data.rows);
      setError(null);
    } else {
      setError(result.error || "Failed to load sheet");
    }
  }, []);

  React.useEffect(() => {
    void (async () => {
      try {
        const [sessionRes, typesRes] = await Promise.all([
          fetch("/api/auth/session"),
          fetch("/api/activity-types"),
        ]);
        const sessionData = await sessionRes.json();
        const typesData = await typesRes.json();
        if (sessionData.success) setRole(sessionData.user.role);
        if (typesData.success) setActivityTypes(typesData.data || []);
      } catch {
        // role only affects the hint text, not correctness
      }
    })();
  }, []);

  React.useEffect(() => {
    void (async () => {
      setIsPageLoading(true);
      setSavedAt(null);
      try {
        await loadSheet(date);
      } catch (err) {
        console.error("Error loading sheet:", err);
        setError("Failed to load sheet");
      } finally {
        setIsPageLoading(false);
      }
    })();
  }, [date, loadSheet]);

  const operationOptions = activityTypes.map((type) => ({
    value: type.id,
    label: type.name,
  }));

  const updateRow = (employeeId: string, patch: Partial<SheetRow>) => {
    setDraft((rows) =>
      rows.map((r) => (r.employeeId === employeeId ? { ...r, ...patch } : r))
    );
    setSavedAt(null);
  };

  const draftTotal = draft.reduce((sum, r) => sum + (r.partsCompleted ?? 0), 0);
  const draftRejected = draft.reduce((sum, r) => sum + (r.partsRejected ?? 0), 0);
  // Accepted is always derived, never typed, so the three can never disagree
  const draftAccepted = draftTotal - draftRejected;
  const draftFilled = draft.filter((r) => r.partsCompleted !== null).length;
  // The server rejects these too, but catching them here means the operator
  // sees which row is wrong instead of a message about an employee id
  const hasOverRejected = draft.some(
    (r) => (r.partsRejected ?? 0) > (r.partsCompleted ?? 0)
  );
  const editable = sheet?.editable ?? false;

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/fettling/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          rows: draft.map((r) => ({
            employeeId: r.employeeId,
            activityTypeId: r.recordedActivityTypeId,
            partsCompleted: r.partsCompleted,
            partsRejected: r.partsRejected,
            notes: r.notes,
          })),
        }),
      });
      const result = await res.json();
      if (result.success) {
        await loadSheet(date);
        setSavedAt(new Date().toLocaleTimeString());
      } else {
        setError(result.error || "Failed to save sheet");
      }
    } catch {
      setError("Failed to save sheet");
    } finally {
      setIsSaving(false);
    }
  };

  if (isPageLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + date navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Daily Fettling Sheet
          </h1>
          <p className="text-[var(--muted-foreground)]">
            Enter how many parts each employee completed
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            title="Previous day"
            onClick={() => setDate(shiftDate(date, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="w-44 shrink-0">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            title="Next day"
            onClick={() => setDate(shiftDate(date, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {date !== todayISO() && (
            <Button variant="secondary" onClick={() => setDate(todayISO())}>
              Today
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-100 text-red-700 text-sm">{error}</div>
      )}

      {/* Locked banner for past days */}
      {!editable && (
        <div className="p-4 rounded-lg bg-[var(--warning-light)] border border-[var(--warning)] flex items-center gap-3">
          <Lock className="h-5 w-5 text-[var(--warning)] shrink-0" />
          <div>
            <p className="font-medium text-amber-800">
              {formatDate(new Date(date))} is locked
            </p>
            <p className="text-sm text-amber-700">
              {role === "FETTLING_MANAGER"
                ? "You can only fill in today's sheet. Ask an admin to correct a past day."
                : "This sheet is read-only for your role."}
            </p>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={sheet?.isToday ? "Today's Total" : "Day Total"}
          value={draftTotal.toLocaleString("en-IN")}
          icon={Package}
          description="parts handled"
        />
        <StatCard
          title="Accepted"
          value={draftAccepted.toLocaleString("en-IN")}
          icon={CheckCircle2}
          iconClassName="bg-green-100"
          description={
            draftTotal > 0
              ? `${((draftAccepted / draftTotal) * 100).toFixed(1)}% of parts handled`
              : "parts passed inspection"
          }
        />
        <StatCard
          title="Rejected"
          value={draftRejected.toLocaleString("en-IN")}
          icon={XCircle}
          iconClassName="bg-red-100"
          description={
            draftTotal > 0
              ? `${((draftRejected / draftTotal) * 100).toFixed(1)}% rejection rate`
              : "parts failed inspection"
          }
        />
        <StatCard
          title="Entries Filled"
          value={`${draftFilled} / ${draft.length}`}
          icon={Users}
          description="employees recorded"
        />
        <StatCard
          title="Sheet Date"
          value={formatDate(new Date(date))}
          icon={ClipboardList}
          description={sheet?.isToday ? "today" : "past day"}
        />
      </div>

      {/* The sheet */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-[var(--primary)]" />
              Employees
              {!editable && (
                <Badge variant="warning" className="ml-2">
                  <Lock className="h-3 w-3 mr-1" />
                  Locked
                </Badge>
              )}
            </CardTitle>
            {savedAt && (
              <span className="flex items-center gap-1.5 text-sm text-green-700">
                <CheckCircle2 className="h-4 w-4" />
                Saved at {savedAt}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {draft.length === 0 ? (
            <div className="text-center py-8 text-[var(--muted-foreground)]">
              No active employees. Add employees first.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-3 px-4 font-semibold text-sm">Employee</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm w-52">
                      Operation
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm w-28">
                      Parts Done
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm w-28">
                      Rejected
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm w-28">
                      Accepted
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Notes</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm w-28">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {draft.map((row) => {
                    const filled = row.partsCompleted !== null;
                    const done = row.partsCompleted ?? 0;
                    const rejected = row.partsRejected ?? 0;
                    const overRejected = rejected > done;
                    const accepted = done - rejected;
                    return (
                      <tr
                        key={row.employeeId}
                        className="border-b border-[var(--border)] hover:bg-[var(--muted)]"
                      >
                        <td className="py-2 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs bg-[var(--muted)] px-1.5 py-0.5 rounded">
                              {row.employeeCode}
                            </span>
                            <span className="font-medium">{row.name}</span>
                          </div>
                        </td>
                        <td className="py-2 px-4">
                          {editable ? (
                            <Select
                              options={operationOptions}
                              value={row.recordedActivityTypeId}
                              onChange={(v) =>
                                updateRow(row.employeeId, {
                                  recordedActivityTypeId: v,
                                })
                              }
                            />
                          ) : (
                            <Badge variant="info">
                              {row.recordedActivityName}
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 px-4">
                          {editable ? (
                            <Input
                              type="number"
                              min="0"
                              placeholder="-"
                              value={
                                row.partsCompleted === null
                                  ? ""
                                  : String(row.partsCompleted)
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                updateRow(row.employeeId, {
                                  partsCompleted: v === "" ? null : Number(v),
                                });
                              }}
                            />
                          ) : (
                            <span className="font-medium">
                              {filled
                                ? row.partsCompleted?.toLocaleString("en-IN")
                                : "-"}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-4">
                          {editable ? (
                            <Input
                              type="number"
                              min="0"
                              max={row.partsCompleted ?? undefined}
                              placeholder="0"
                              error={overRejected ? "Over parts done" : undefined}
                              value={
                                row.partsRejected === null
                                  ? ""
                                  : String(row.partsRejected)
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                updateRow(row.employeeId, {
                                  partsRejected: v === "" ? null : Number(v),
                                });
                              }}
                            />
                          ) : (
                            <span
                              className={
                                (row.partsRejected ?? 0) > 0
                                  ? "font-medium text-red-600"
                                  : "text-[var(--muted-foreground)]"
                              }
                            >
                              {filled
                                ? (row.partsRejected ?? 0).toLocaleString("en-IN")
                                : "-"}
                            </span>
                          )}
                        </td>
                        {/* Accepted is shown, never typed - it is the
                            difference, so it cannot be entered wrong */}
                        <td className="py-2 px-4">
                          <span
                            className={
                              filled
                                ? "font-semibold text-green-700"
                                : "text-[var(--muted-foreground)]"
                            }
                          >
                            {filled
                              ? accepted.toLocaleString("en-IN")
                              : "-"}
                          </span>
                        </td>
                        <td className="py-2 px-4">
                          {editable ? (
                            <Input
                              placeholder="Optional"
                              value={row.notes}
                              onChange={(e) =>
                                updateRow(row.employeeId, { notes: e.target.value })
                              }
                            />
                          ) : (
                            <span className="text-sm text-[var(--muted-foreground)]">
                              {row.notes || "-"}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-4">
                          {filled ? (
                            <Badge variant="success">Recorded</Badge>
                          ) : (
                            <Badge variant="default">Pending</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)]">
                    <td className="py-3 px-4 font-semibold" colSpan={2}>
                      Total
                    </td>
                    <td className="py-3 px-4 font-bold text-[var(--primary)]">
                      {draftTotal.toLocaleString("en-IN")}
                    </td>
                    <td className="py-3 px-4 font-bold text-red-600">
                      {draftRejected.toLocaleString("en-IN")}
                    </td>
                    <td className="py-3 px-4 font-bold text-green-700">
                      {draftAccepted.toLocaleString("en-IN")}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save */}
      {editable && draft.length > 0 && (
        <div className="flex items-center justify-end gap-3">
          <p className="text-sm text-[var(--muted-foreground)]">
            {hasOverRejected ? (
              <span className="text-[var(--error)]">
                A row has more rejects than parts done - fix it to save.
              </span>
            ) : (
              "Leave a box empty if the employee had no output that day."
            )}
          </p>
          <Button
            onClick={handleSave}
            isLoading={isSaving}
            disabled={hasOverRejected}
          >
            <Save className="h-4 w-4 mr-2" />
            Save Sheet
          </Button>
        </div>
      )}
    </div>
  );
}
