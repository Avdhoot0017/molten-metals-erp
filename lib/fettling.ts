import type { SessionUser, AluminumType } from "@/types";
import { materialType } from "@/lib/ingot";
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

/**
 * What a line's rejected castings weigh, in grams.
 *
 * A weighed figure wins when there is one: the bench scale knows things the
 * count does not, like a casting rejected as a part-filled pour. With no
 * weight given it falls back to count x the part's weight, which is what this
 * always did and is right for a whole casting.
 */
export function rejectedScrapWeight(item: {
  partsRejected: number;
  rejectedWeight?: number | null;
  part: { weightPerPiece: number };
}): number {
  // A deliberate 0 is meaningful - the rejects were scrapped elsewhere - so
  // only null and undefined fall through to the calculation
  if (item.rejectedWeight !== null && item.rejectedWeight !== undefined) {
    return item.rejectedWeight;
  }
  return item.partsRejected * item.part.weightPerPiece;
}

/**
 * The scrap a day's fettling put into stock.
 *
 * A casting rejected at fettling is scrap metal, not just a number: two
 * rejected pieces of a 1.2 kg part are 2.4 kg that has to appear somewhere.
 * The alloy comes from the part - a casting drawing specifies one, which is
 * why the grade lives on the part rather than being asked for on every entry.
 *
 * Returned as a net weight per material line, so an edit is the difference
 * between what the entry used to be responsible for and what it is now. That
 * is the same shape production amendments use, and it handles a changed count,
 * a changed weight, a changed part, and all of them at once without special
 * cases.
 */
export function fettlingScrapMovements(
  items: Array<{
    partsRejected: number;
    rejectedWeight?: number | null;
    part: { weightPerPiece: number; alloyGrade: string };
  }>
): Map<AluminumType, number> {
  const moves = new Map<AluminumType, number>();

  for (const item of items) {
    if (item.partsRejected <= 0) continue;
    const weight = rejectedScrapWeight(item);
    if (weight <= 0) continue;

    const type = materialType("REJECTED_PART", item.part.alloyGrade);
    moves.set(type, (moves.get(type) ?? 0) + weight);
  }

  return moves;
}

/**
 * What has to move to get from one set of scrap movements to another.
 *
 * Only lines that actually change are returned, so an edit that leaves the
 * rejects alone writes nothing at all.
 */
export function scrapDelta(
  before: Map<AluminumType, number>,
  after: Map<AluminumType, number>
): Map<AluminumType, number> {
  const deltas = new Map<AluminumType, number>();
  for (const type of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(type) ?? 0) - (before.get(type) ?? 0);
    if (delta !== 0) deltas.set(type, delta);
  }
  return deltas;
}
