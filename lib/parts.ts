/**
 * Casting weights.
 *
 * A part is poured with its gating system attached - runners, risers, feeders -
 * which is cut off once the casting has solidified. So two weights describe a
 * part: what the mould takes, and what the customer receives. The scrap is the
 * difference, and is therefore never stored: it is worked out here, from one
 * place, so no screen can show a figure that disagrees with the two it comes
 * from.
 *
 * All weights are in grams, the unit the database stores. lib/units.ts converts
 * to and from the kg an operator types.
 */

/** The weights any caller needs to work out a part's scrap. */
export interface CastingWeights {
  weightPerPiece: number;
  /** Null for a part recorded before pouring weights were tracked. */
  pouringWeight: number | null;
}

/**
 * Gating cut off one casting, in grams.
 *
 * Null - not zero - when the pouring weight has not been recorded. The
 * difference matters: zero would claim the mould takes exactly the casting's
 * weight and no scrap comes back, which is never true of a real part. Callers
 * should show nothing rather than a figure they do not have.
 */
export function expectedScrapOf(part: CastingWeights): number | null {
  if (!part.pouringWeight) return null;
  // Guards against a part whose weights were entered the wrong way round
  const scrap = part.pouringWeight - part.weightPerPiece;
  return scrap > 0 ? scrap : null;
}
