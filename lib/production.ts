/**
 * Rules about how a batch moves through its stages, shared by the API and the
 * form so a limit is stated once rather than enforced twice with two numbers.
 */

/**
 * How many unfinished batches one furnace may carry.
 *
 * A heat is recorded in stages, which means paperwork can lag the metal. Past
 * a few open batches on the same furnace an operator stops being able to tell
 * which heat they are filling in, so the open ones have to be closed first.
 */
export const MAX_OPEN_BATCHES_PER_FURNACE = 3;

/**
 * Batch numbering.
 *
 * A batch number reads as year, month, sequence: the 3rd batch of September
 * 2026 is `26I01`... `26I03`. The month is a letter (A for January through L
 * for December) so the number stays short and a month boundary is visible at a
 * glance rather than needing the digits parsed.
 *
 * The sequence restarts at 01 each month, so it says how many heats the
 * foundry has run this month - which is the question people actually ask of it.
 */

/** A for January through L for December. */
const MONTH_LETTERS = "ABCDEFGHIJKL";

export function monthLetter(monthIndex: number): string {
  return MONTH_LETTERS[monthIndex] ?? "?";
}

/** The year-and-month part every batch in a given month shares, e.g. "26I". */
export function batchPrefix(date: Date): string {
  const year = String(date.getFullYear() % 100).padStart(2, "0");
  return `${year}${monthLetter(date.getMonth())}`;
}

/**
 * The sequence number out of a batch number, or null if it is not one of ours.
 *
 * Older batches used a different format entirely (BATCH-20260906-417), so they
 * must not be read as a sequence - otherwise the first batch of a month could
 * take a number that is already in use.
 */
export function sequenceOf(batchNumber: string, prefix: string): number | null {
  if (!batchNumber.startsWith(prefix)) return null;
  const tail = batchNumber.slice(prefix.length);
  if (!/^\d+$/.test(tail)) return null;
  return Number(tail);
}

/** Formats a sequence for display: at least two digits, more if it runs over. */
export function formatBatchNumber(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(2, "0")}`;
}
