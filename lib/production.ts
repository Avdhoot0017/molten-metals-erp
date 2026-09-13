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

/**
 * The metal balance of a heat: what went in against what came out.
 *
 * Everything charged into a furnace has to end up somewhere - as good
 * castings, as scrap, or lost to oxidation and dross in the melt. So the three
 * figures an operator types at completion are not independent: they are
 * accounting for a known quantity of metal, and if they do not add up, one of
 * them is wrong.
 *
 * Two things can be wrong in opposite directions:
 *
 *   - MORE metal out than in. Physically impossible, so it is a typo - usually
 *     a part weight, a count, or a scrap figure in the wrong unit.
 *   - Far LESS out than in. Possible, but a fifth of the charge vanishing is
 *     either a mis-entry or something that genuinely needs recording.
 *
 * Neither is blocked. A foundry sometimes has a bad heat, the scale is
 * sometimes wrong, and the person at the furnace knows things this arithmetic
 * does not. The balance is shown plainly and an explanation is invited, but
 * the operator decides - a system that refuses the number in front of them
 * just gets a made-up number instead.
 */

/** Melt loss above this share of the charge is flagged. 5% is generous. */
export const MELT_LOSS_TOLERANCE = 0.05;

/**
 * Rounding slack before "more out than in" is called.
 *
 * Part weights are per-piece figures multiplied by a count, so a few grams of
 * drift across a large batch is arithmetic, not a mistake.
 */
const OVER_ALLOWANCE = 0.005;

export type BalanceVerdict = "ok" | "high-loss" | "over";

export interface MeltBalance {
  /** Ingot plus any scrap re-melted, in grams. */
  charge: number;
  /** Good castings at their own weight per piece. */
  output: number;
  scrapGenerated: number;
  /** Output plus scrap - everything the batch can account for. */
  accounted: number;
  /** Charge minus accounted. Negative means more came out than went in. */
  meltLoss: number;
  /** Melt loss as a share of the charge, 0 when nothing was charged. */
  lossPercent: number;
  verdict: BalanceVerdict;
  /** True when the figure is odd enough to be worth a note. Never enforced. */
  worthExplaining: boolean;
  /** Plain-language description, or null when the balance is unremarkable. */
  message: string | null;
}

export function meltBalance(input: {
  charge: number;
  output: number;
  scrapGenerated: number;
}): MeltBalance {
  const { charge, output, scrapGenerated } = input;
  const accounted = output + scrapGenerated;
  const meltLoss = charge - accounted;
  const lossPercent = charge > 0 ? (meltLoss / charge) * 100 : 0;

  let verdict: BalanceVerdict = "ok";
  let message: string | null = null;

  // Nothing has been entered yet, so there is nothing to judge. Without this
  // the panel would open shouting about 100% melt loss before the operator has
  // typed a single figure - a warning that is always wrong on arrival teaches
  // people to ignore warnings.
  const nothingEntered = accounted === 0;

  if (nothingEntered) {
    // leave it as "ok"
  } else if (charge > 0 && meltLoss < -charge * OVER_ALLOWANCE) {
    verdict = "over";
    message =
      "This accounts for more metal than went into the furnace. Worth checking the part weights, the counts and the scrap figures - but save it if you know it is right.";
  } else if (charge > 0 && meltLoss > charge * MELT_LOSS_TOLERANCE) {
    verdict = "high-loss";
    message = `Melt loss is ${lossPercent.toFixed(1)}% of the charge, above the ${(
      MELT_LOSS_TOLERANCE * 100
    ).toFixed(0)}% a heat normally loses. Worth a note if you know what happened.`;
  }

  return {
    charge,
    output,
    scrapGenerated,
    accounted,
    meltLoss,
    lossPercent,
    verdict,
    worthExplaining: verdict !== "ok",
    message,
  };
}
