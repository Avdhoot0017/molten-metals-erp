/**
 * Plant-wide settings.
 *
 * Stored as rows in `app_settings`, but nothing outside this file deals in raw
 * strings: a caller asks for the settings object and gets typed values with
 * defaults filled in. A missing row is the normal state on a fresh
 * installation, not an error.
 */
import prisma from "@/lib/prisma";
import { kgToGrams, gramsToKg } from "@/lib/units";

export interface AppSettings {
  /** Shown on purchase order PDFs. */
  companyName: string;
  plantName: string;
  address: string;
  gstNumber: string;
  /**
   * Stock at or below this is flagged on the dashboard. Held in GRAMS, like
   * every other weight in the database; the form works in kg.
   */
  lowStockThreshold: number;
  currency: string;
  weightUnit: string;
  dateFormat: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: "Molten Metals Pvt. Ltd.",
  plantName: "Main Plant - Pune",
  address: "123 Industrial Area, Phase 2, Pune, Maharashtra 411057",
  gstNumber: "27AABCM1234R1Z5",
  lowStockThreshold: kgToGrams(10),
  currency: "INR",
  weightUnit: "kg",
  dateFormat: "DD/MM/YYYY",
};

/** Reads every setting, falling back to the default for anything unset. */
export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.appSetting.findMany();
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const text = (key: keyof AppSettings, fallback: string) =>
    stored.get(key)?.trim() || fallback;

  const threshold = Number(stored.get("lowStockThreshold"));

  return {
    companyName: text("companyName", DEFAULT_SETTINGS.companyName),
    plantName: text("plantName", DEFAULT_SETTINGS.plantName),
    address: text("address", DEFAULT_SETTINGS.address),
    gstNumber: text("gstNumber", DEFAULT_SETTINGS.gstNumber),
    // A stored value that is not a usable number falls back rather than
    // silently flagging everything or nothing as low stock
    lowStockThreshold:
      Number.isFinite(threshold) && threshold >= 0
        ? threshold
        : DEFAULT_SETTINGS.lowStockThreshold,
    currency: text("currency", DEFAULT_SETTINGS.currency),
    weightUnit: text("weightUnit", DEFAULT_SETTINGS.weightUnit),
    dateFormat: text("dateFormat", DEFAULT_SETTINGS.dateFormat),
  };
}

/**
 * Writes the settings that were supplied, leaving the rest alone.
 *
 * Returns an error message for a value that cannot be stored, so the caller
 * can answer 400 rather than saving something the app will later reject.
 */
export async function saveSettings(
  input: Partial<Record<keyof AppSettings, unknown>>
): Promise<{ error: string | null }> {
  const writes: Array<{ key: string; value: string }> = [];

  const textKeys: Array<keyof AppSettings> = [
    "companyName",
    "plantName",
    "address",
    "gstNumber",
    "currency",
    "weightUnit",
    "dateFormat",
  ];

  for (const key of textKeys) {
    const raw = input[key];
    if (raw === undefined) continue;
    const value = String(raw).trim();
    if (value.length > 300) {
      return { error: `${key} is too long (300 characters max)` };
    }
    writes.push({ key, value });
  }

  if (input.lowStockThreshold !== undefined) {
    const grams = Number(input.lowStockThreshold);
    if (!Number.isFinite(grams) || grams < 0) {
      return { error: "Low stock threshold must be a weight of 0 or more" };
    }
    writes.push({ key: "lowStockThreshold", value: String(grams) });
  }

  await prisma.$transaction(
    writes.map((w) =>
      prisma.appSetting.upsert({
        where: { key: w.key },
        update: { value: w.value },
        create: { key: w.key, value: w.value },
      })
    )
  );

  return { error: null };
}

/** The settings shaped for the form, which works in kg rather than grams. */
export function settingsForForm(settings: AppSettings) {
  return {
    ...settings,
    lowStockThreshold: String(gramsToKg(settings.lowStockThreshold)),
  };
}
