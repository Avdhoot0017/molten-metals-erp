import type { SessionUser } from "@/types";

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
 * A fettling manager may only enter or amend the current day's sheet — once a
 * day has passed its numbers are locked and only an admin can correct them.
 */
export function canEditSheetForDate(
  user: SessionUser | null,
  date: Date
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  if (user.role !== "FETTLING_MANAGER") return false;
  return date.getTime() === todayUtc().getTime();
}

/** Human-readable reason a sheet is locked, for API error messages. */
export const SHEET_LOCKED_MESSAGE =
  "This date is locked. Only an admin can change a past day's sheet.";
