/**
 * Density Index (Reduced Pressure Test).
 *
 *   DI = (rhoA - rhoB) / rhoA * 100
 *
 * rhoA - density of a sample solidified under atmospheric pressure
 * rhoB - density of a sample solidified under reduced pressure / vacuum
 *
 * The result is a percentage and the ratio is dimensionless, so the two
 * densities only have to share the same unit (g/cm3, kg/m3, ...).
 *
 * DI indicates dissolved hydrogen in the melt: a low value means a clean,
 * well-degassed melt, a high value means gas porosity risk.
 */

/** Returns DI as a percentage, or null when the inputs cannot produce one. */
export function calculateDensityIndex(
  densityAtmospheric: number,
  densityVacuum: number
): number | null {
  if (!Number.isFinite(densityAtmospheric) || !Number.isFinite(densityVacuum)) {
    return null;
  }
  // rhoA is the divisor, so it must be a real positive density
  if (densityAtmospheric <= 0 || densityVacuum <= 0) return null;

  return ((densityAtmospheric - densityVacuum) / densityAtmospheric) * 100;
}

/**
 * Validates a density pair before it is stored.
 * Returns an error message, or null when the pair is acceptable.
 */
export function validateDensityPair(
  densityAtmospheric: number,
  densityVacuum: number
): string | null {
  if (!Number.isFinite(densityAtmospheric) || densityAtmospheric <= 0) {
    return "Atmospheric density must be a positive number";
  }
  if (!Number.isFinite(densityVacuum) || densityVacuum <= 0) {
    return "Vacuum density must be a positive number";
  }
  // The vacuum sample traps expanded gas, so it can never be the denser one.
  // A higher value almost always means the two samples were entered the wrong
  // way round.
  if (densityVacuum > densityAtmospheric) {
    return "Vacuum density cannot exceed atmospheric density - check the two samples are not swapped";
  }
  return null;
}

/** Formats a DI value for display, e.g. "3.42%". */
export function formatDensityIndex(di: number | null | undefined): string {
  if (di === null || di === undefined || !Number.isFinite(di)) return "-";
  return `${di.toFixed(2)}%`;
}
