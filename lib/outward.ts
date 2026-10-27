import { batchPrefix, formatBatchNumber, sequenceOf } from "@/lib/production";

/**
 * Outward notes - finished castings leaving for a customer.
 *
 * Numbered the way batches are, for the same reason: year, month letter and
 * a sequence that restarts each month, so `OUT-26J04` reads as the fourth
 * delivery of October 2026 without anyone having to parse a date.
 */

export const OUTWARD_PREFIX = "OUT-";

/** The part every outward note in a given month shares, e.g. "OUT-26J". */
export function outwardPrefix(date: Date): string {
  return `${OUTWARD_PREFIX}${batchPrefix(date)}`;
}

/**
 * The next free number for a month, given the ones already used.
 *
 * Notes recorded in some other format are ignored rather than parsed, so an
 * old number can never be re-issued by accident.
 */
export function nextOutwardNumber(existing: string[], date: Date): string {
  const prefix = outwardPrefix(date);
  const highest = existing.reduce((max, number) => {
    const sequence = sequenceOf(number, prefix);
    return sequence !== null && sequence > max ? sequence : max;
  }, 0);
  return formatBatchNumber(prefix, highest + 1);
}

/**
 * What a line of an outward note weighs, in grams.
 *
 * The finished weight, not the pouring weight: the gating was cut off in the
 * shop and went back to the melt long before this. What leaves the gate is
 * the casting the customer ordered.
 */
export function outwardWeight(pieces: number, weightPerPiece: number): number {
  return Math.max(0, pieces) * (weightPerPiece || 0);
}
