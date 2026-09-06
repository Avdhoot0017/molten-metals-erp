import type { SessionUser } from "@/types";
import { canWrite } from "@/lib/permissions";

/**
 * Parses a YYYY-MM-DD string into a UTC-midnight Date.
 * FettlingActivity.date is a DATE column, so anchoring at UTC keeps the stored
 * day from shifting with the server's timezone.
 */
export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Today at UTC midnight, matching how activity dates are stored. */
export function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Formats a Date as YYYY-MM-DD using its UTC parts. */
export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * How far back a manager may still enter or correct a day: today, and the day
 * before it.
 *
 * A shift often gets written up the next morning, so locking at midnight would
 * make yesterday's real work unrecordable. Beyond that the numbers have been
 * reported on, and changing them becomes a correction rather than data entry.
 */
export const EDIT_WINDOW_DAYS = 1;

/**
 * Whether this person may enter or amend the sheet for a given day.
 *
 * Who may edit at all comes from the permission matrix, so it follows the role
 * definitions rather than a second list here. WHEN they may edit is the extra
 * rule: an admin has no window, everyone else has today and yesterday.
 */
export function canEditSheetForDate(
  user: SessionUser | null,
  date: Date
): boolean {
  if (!user) return false;
  if (!canWrite(user, "fettling")) return false;
  if (user.role === "ADMIN") return true;

  const daysAgo = (todayUtc().getTime() - date.getTime()) / 86_400_000;
  // A day in the future is not editable either - it has not happened yet
  return daysAgo >= 0 && daysAgo <= EDIT_WINDOW_DAYS;
}

/** Human-readable reason a sheet is locked, for API error messages. */
export const SHEET_LOCKED_MESSAGE =
  "This date is locked. You can only record today and yesterday - ask an admin to change an older day.";
