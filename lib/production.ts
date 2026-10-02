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

/**
 * What a batch's castings account for, worked out from the parts themselves.
 *
 * Every part carries a pouring weight and a finished weight, so once the
 * counts are entered the metal is fully determined and nobody needs to work it
 * out on paper:
 *
 *   poured        every casting at its pouring weight - what left the furnace
 *   runnerRaiser  the gating cut off the castings that PASSED
 *   rejectedPart  the castings that failed, gating and all
 *   goodWeight    the bodies of the castings that passed
 *
 * The split between the middle two is the whole point. A casting rejected at
 * the furnace is thrown in the scrap bin as it came out of the mould - nobody
 * cuts the runners off a casting they are about to re-melt - so it goes back
 * at its POURING weight, not at the weight of the part it was going to be. A
 * 5 kg part poured at 10 kg is 10 kg of scrap when it fails, not 5.
 *
 * Only castings that are kept have their gating cut off, so only those
 * contribute runner and riser scrap.
 *
 * The three outputs still add up to `poured` exactly:
 *   good x finished + good x gating + rejected x pouring = poured
 */
export interface CastingOutput {
  poured: number;
  runnerRaiser: number;
  rejectedPart: number;
  goodWeight: number;
  /** False when any line's part has no pouring weight, so nothing was assumed. */
  complete: boolean;
}

export function castingOutput(
  lines: Array<{
    quantityProduced: number;
    goodParts: number;
    part: { weightPerPiece: number; pouringWeight: number | null };
  }>
): CastingOutput {
  let poured = 0;
  let runnerRaiser = 0;
  let rejectedPart = 0;
  let goodWeight = 0;
  let complete = lines.length > 0;

  for (const line of lines) {
    const qty = line.quantityProduced;
    const good = Math.min(line.goodParts, qty);
    const rejected = qty - good;
    const finished = line.part.weightPerPiece;

    // No pouring weight means the gating was never measured for this part.
    // Its castings still weigh what they weigh, but the metal poured and the
    // gating coming back cannot be known, so the figures are marked incomplete
    // rather than quietly understated.
    const pouring = line.part.pouringWeight;
    if (!pouring || pouring < finished) {
      complete = false;
      goodWeight += good * finished;
      // Without a pouring weight the gating is unknown, so a failed casting
      // can only be counted at the weight that IS known - understating it,
      // which is why the figures are marked incomplete
      rejectedPart += rejected * finished;
      poured += qty * finished;
      continue;
    }

    poured += qty * pouring;
    // Gating comes back only from the castings somebody kept
    runnerRaiser += good * (pouring - finished);
    goodWeight += good * finished;
    // A failed casting goes to the melt whole, runners and all
    rejectedPart += rejected * pouring;
  }

  return { poured, runnerRaiser, rejectedPart, goodWeight, complete };
}

/**
 * The metal a batch had to work with, in grams.
 *
 * Three sources, and the third is the one that catches people out: metal
 * carried over from the previous heat is part of the charge but is NOT stock -
 * it was deducted from inventory when that earlier batch was charged, and is
 * still sitting in the furnace.
 */
export function chargeOf(record: {
  aluminumUsed: number;
  totalScrapUsed: number;
  carriedInWeight?: number | null;
}): number {
  return (
    record.aluminumUsed + record.totalScrapUsed + (record.carriedInWeight ?? 0)
  );
}

/**
 * What should still be in the furnace: everything charged, less everything
 * poured into moulds.
 *
 * An estimate, and offered as one. Real heats lose metal to dross and
 * oxidation, so the operator can correct it - and the difference between this
 * figure and what they enter is exactly that loss.
 */
export function suggestedHeel(charge: number, poured: number): number {
  return Math.max(0, charge - poured);
}
