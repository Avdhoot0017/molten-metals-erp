/**
 * Weight unit handling for the ERP.
 *
 * Kilograms are the unit the user sees and types, everywhere in the app.
 *
 * Grams remain the unit the *database* stores, because that is how every
 * existing row was written and rewriting them would be a lossy migration for
 * no gain. This file is the single boundary between the two: values are
 * divided by 1000 on the way out to a screen and multiplied by 1000 on the way
 * back in from a form. Nothing else in the app should do that arithmetic.
 *
 * So: anything read from the API is grams, anything shown to a user is kg.
 */

export const GRAMS_PER_KG = 1000;

/** Display unit suffix, e.g. for input labels: `Quantity (${WEIGHT_UNIT})`. */
export const WEIGHT_UNIT = "kg";

/** Grams -> kilograms. */
export function gramsToKg(grams: number): number {
  return (grams ?? 0) / GRAMS_PER_KG;
}

/** Kilograms -> grams. */
export function kgToGrams(kg: number): number {
  return (kg ?? 0) * GRAMS_PER_KG;
}

/**
 * Formats a value stored in grams for display in kilograms, e.g. a stored
 * 185000 renders as `185.00 kg`.
 *
 * Up to three decimals are kept so that light parts stay readable: a 125 g
 * casting shows as `0.125 kg` rather than rounding away to `0.13`.
 */
export function formatWeight(grams: number, options?: { unit?: boolean }): string {
  const value = gramsToKg(grams ?? 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
  return options?.unit === false ? value : `${value} ${WEIGHT_UNIT}`;
}

/**
 * Parses a weight typed into a form field. The user types kilograms; the value
 * returned is grams, ready to send to the API. Returns 0 for blank or
 * non-numeric input.
 */
export function parseWeightInput(input: string | number): number {
  const kg = typeof input === "number" ? input : parseFloat(input);
  return Number.isFinite(kg) ? kgToGrams(kg) : 0;
}

/**
 * Formats a stored gram value as a form's default value - kilograms, with no
 * unit suffix and no thousands separators, so it round-trips through
 * `parseWeightInput` unchanged.
 */
export function weightToInput(grams: number): string {
  if (!Number.isFinite(grams)) return "";
  return String(gramsToKg(grams));
}

/**
 * Converts a raw gram value to a plain kilogram number for spreadsheet export,
 * where a formatted string would stop Excel treating the cell as a number.
 */
export function weightForExport(grams: number): number {
  // Rounded only far enough to clear binary-float noise (0.30000000000000004),
  // not far enough to lose a real reading: a 1250.5 g entry exports as 1.2505,
  // so a spreadsheet total of the column still matches the gram figures.
  return Number(gramsToKg(grams ?? 0).toFixed(6));
}
