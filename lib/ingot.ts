/**
 * The material model: every stock line is one alloy grade in one form.
 *
 * Grade is not a property of ingot alone. A runner cut off an LM6 casting is
 * still LM6 metal, and re-melting it into an LM9 heat would put the alloy out
 * of spec. So scrap carries the grade of the heat it came off, and the foundry
 * holds a separate stock line for each grade-and-form pair.
 *
 * Grade and form are encoded together in one name - INGOT_LM6, SPILLAGE_LM9 -
 * so one inventory table, one log and one set of queries cover every material.
 * This module is the only place that knows how that name is put together or
 * taken apart.
 *
 * The grades themselves are NOT listed here. They are rows in alloy_grades,
 * configured by the admin, because a melt's resulting alloy is a shop-floor
 * decision: three grades charged together come out as a fourth that has to
 * exist as a material in its own right. So everything in this module that
 * needs the list takes it as an argument - see lib/grades.ts for reading it
 * on the server, and /api/alloy-grades for the browser.
 */
import type { AluminumType } from "@/types";

/**
 * One alloy, as the master holds it.
 *
 * Only the fields this module needs to draw and compose names. The full row
 * lives in lib/grades.ts.
 */
export interface GradeRef {
  id: string;
  name: string;
  description?: string | null;
  colorHex?: string | null;
  sortOrder?: number;
}

/**
 * Colours for grades the admin has not given one, handed out by position.
 *
 * A grade still has to be told apart on a chart the moment it is created, so
 * there is always a colour; the first three match what LM6, LM9 and LM25 have
 * always been drawn with.
 */
export const GRADE_PALETTE = [
  "#B8860B",
  "#10B981",
  "#8B5CF6",
  "#2563EB",
  "#DB2777",
  "#EA580C",
  "#0891B2",
  "#65A30D",
];

export function gradeHex(grade: GradeRef, index = 0): string {
  return grade.colorHex || GRADE_PALETTE[index % GRADE_PALETTE.length];
}

/*
 * Grade colours are inline styles, not Tailwind classes.
 *
 * They were classes while there were three known grades. A grade the admin
 * invents at four o'clock has no class to name, and Tailwind cannot generate
 * one from a value it has never seen, so the colour travels as a style.
 */
export function gradeDotStyle(grade: GradeRef, index = 0) {
  return { backgroundColor: gradeHex(grade, index) };
}

/** The same colour at a tenth, for a card or icon tint. */
export function gradeTintStyle(grade: GradeRef, index = 0) {
  return { backgroundColor: `${gradeHex(grade, index)}1a` };
}

/**
 * The three grades this foundry started with, used to seed the master and
 * nothing else. Never read to decide what exists - the table decides.
 */
export const SEED_GRADES = [
  { name: "LM6", description: "AlSi12 - general casting alloy", colorHex: "#B8860B", sortOrder: 1 },
  { name: "LM9", description: "AlSi10Mg - higher strength", colorHex: "#10B981", sortOrder: 2 },
  { name: "LM25", description: "AlSi7Mg - heat treatable", colorHex: "#8B5CF6", sortOrder: 3 },
];

/**
 * A grade name as it may be stored: upper case, no separators.
 *
 * The underscore is barred because a material name is "FORM_GRADE" - a grade
 * with an underscore in it could not be read back out reliably.
 */
export const GRADE_NAME_PATTERN = /^[A-Z0-9][A-Z0-9-]*$/;

export function normaliseGradeName(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** Null when the name is usable, otherwise why it is not. */
export function gradeNameProblem(raw: string): string | null {
  const name = normaliseGradeName(raw);
  if (!name) return "Enter the alloy name";
  if (name.length > 24) return "That name is too long";
  if (!GRADE_NAME_PATTERN.test(name)) {
    return "Use letters, digits and hyphens only - for example LM6 or A356";
  }
  return null;
}

/** The form metal is held in: fresh ingot, or one of the three scrap streams. */
export type MaterialForm =
  | "INGOT"
  | "RUNNER_RAISER"
  | "SPILLAGE"
  | "REJECTED_PART";

export interface MaterialFormSpec {
  form: MaterialForm;
  /** Name on its own, e.g. "Runner & Raiser". Grade is added separately. */
  label: string;
  description: string;
  isScrap: boolean;
}

export const MATERIAL_FORMS: MaterialFormSpec[] = [
  {
    form: "INGOT",
    label: "Ingot",
    description: "Fresh aluminium ingot bought in",
    isScrap: false,
  },
  {
    form: "RUNNER_RAISER",
    label: "Runner & Raiser",
    description: "Gating system cut off the casting",
    isScrap: true,
  },
  {
    form: "SPILLAGE",
    label: "Spillage",
    description: "Metal spilt during pouring",
    isScrap: true,
  },
  {
    form: "REJECTED_PART",
    label: "Rejected Part",
    description: "Castings failed at inspection",
    isScrap: true,
  },
];

/** Every form except fresh ingot - the three scrap streams. */
export type ScrapForm = Exclude<MaterialForm, "INGOT">;

export interface ScrapFormSpec extends MaterialFormSpec {
  form: ScrapForm;
}

export const SCRAP_FORMS: ScrapFormSpec[] = MATERIAL_FORMS.filter(
  (f): f is ScrapFormSpec => f.isScrap
);

/** Builds the enum value for a form and grade, e.g. ("SPILLAGE", "LM9"). */
export function materialType(form: MaterialForm, grade: string): AluminumType {
  return `${form}_${grade}` as AluminumType;
}

/** Splits an enum value back into its form and grade. */
export function parseMaterialType(type: AluminumType): {
  form: MaterialForm;
  grade: string;
} {
  // Longest form name first, so RUNNER_RAISER is not read as RUNNER
  const spec = [...MATERIAL_FORMS]
    .sort((a, b) => b.form.length - a.form.length)
    .find((f) => type.startsWith(`${f.form}_`));
  if (!spec) {
    // A name that does not start with a known form. Returns the whole string
    // as the grade rather than guessing, so a bad value stays visible.
    return { form: "INGOT", grade: type };
  }
  return { form: spec.form, grade: type.slice(spec.form.length + 1) };
}

export function isIngotType(type: AluminumType): boolean {
  return parseMaterialType(type).form === "INGOT";
}

export function isScrapType(type: AluminumType): boolean {
  return !isIngotType(type);
}

/** "LM6" for any material type, ingot or scrap. */
export function gradeName(type: AluminumType): string {
  return parseMaterialType(type).grade;
}

export function formSpec(form: MaterialForm): MaterialFormSpec {
  return MATERIAL_FORMS.find((f) => f.form === form) ?? MATERIAL_FORMS[0];
}

/** Full display name for a stock line, e.g. "LM9 Spillage". */
export function materialLabel(type: AluminumType): string {
  const { form, grade } = parseMaterialType(type);
  return `${grade} ${formSpec(form).label}`;
}

// ---------------------------------------------------------------- type lists
//
// Every list below is built from the grades handed in, never from a constant:
// the foundry's alloys are rows the admin maintains, and a list baked in here
// would silently leave a new grade out of stock, pickers and reports.

export function gradeSpec(
  name: string,
  grades: GradeRef[]
): GradeRef | undefined {
  return grades.find((g) => g.name === name);
}

export function ingotTypesFor(grades: GradeRef[]): AluminumType[] {
  return grades.map((g) => materialType("INGOT", g.name));
}

export function scrapTypesFor(grades: GradeRef[]): AluminumType[] {
  return SCRAP_FORMS.flatMap((f) =>
    grades.map((g) => materialType(f.form, g.name))
  );
}

/** Every stock line for these grades, ingot first, in display order. */
export function materialTypesFor(grades: GradeRef[]): AluminumType[] {
  return [...ingotTypesFor(grades), ...scrapTypesFor(grades)];
}

/** The scrap lines belonging to one grade - what a heat of it may re-melt. */
export function scrapTypesForGrade(grade: string): AluminumType[] {
  return SCRAP_FORMS.map((f) => materialType(f.form, grade));
}

/** A grade with its ingot stock line and label, for the ingot pickers. */
export interface IngotGrade extends GradeRef {
  type: AluminumType;
  label: string;
  hex: string;
}

export function ingotGradesFor(grades: GradeRef[]): IngotGrade[] {
  return grades.map((g, index) => ({
    ...g,
    type: materialType("INGOT", g.name),
    label: `${g.name} Ingot`,
    hex: gradeHex(g, index),
  }));
}

// --------------------------------------------------------------- aggregation

/** Sums the ingot lines out of a type -> quantity map. */
export function totalIngot(
  quantities: Partial<Record<AluminumType, number>>,
  grades: GradeRef[]
): number {
  return ingotTypesFor(grades).reduce(
    (sum, type) => sum + (quantities[type] ?? 0),
    0
  );
}

/** Sums every scrap line out of a type -> quantity map. */
export function totalScrapHeld(
  quantities: Partial<Record<AluminumType, number>>,
  grades: GradeRef[]
): number {
  return scrapTypesFor(grades).reduce(
    (sum, type) => sum + (quantities[type] ?? 0),
    0
  );
}

/** Sums everything held in one grade, ingot and scrap together. */
export function totalForGrade(
  quantities: Partial<Record<AluminumType, number>>,
  grade: string
): number {
  return MATERIAL_FORMS.reduce(
    (sum, f) => sum + (quantities[materialType(f.form, grade)] ?? 0),
    0
  );
}

/** One grade's slice of a figure - stock held, or metal charged. */
export interface GradeSlice extends IngotGrade {
  quantity: number;
  /** Percent of the ingot total, not of all aluminium. 0 when nothing is held. */
  percentage: number;
}

/**
 * Splits an ingot figure across the grades.
 *
 * Returns a row for every grade handed in, including those sitting at zero: a
 * foundry needs to see that LM9 is empty, and a row that vanishes when it hits
 * zero hides exactly the fact worth knowing.
 */
export function ingotSplit(
  quantities: Partial<Record<AluminumType, number>>,
  grades: GradeRef[]
): GradeSlice[] {
  const total = totalIngot(quantities, grades);
  return ingotGradesFor(grades).map((grade) => {
    const quantity = quantities[grade.type] ?? 0;
    return {
      ...grade,
      quantity,
      percentage: total > 0 ? (quantity / total) * 100 : 0,
    };
  });
}

/** The same split for scrap: every grade, every scrap form summed. */
export function scrapSplit(
  quantities: Partial<Record<AluminumType, number>>,
  grades: GradeRef[]
): GradeSlice[] {
  const total = totalScrapHeld(quantities, grades);
  return ingotGradesFor(grades).map((g) => {
    const quantity = SCRAP_FORMS.reduce(
      (sum, f) => sum + (quantities[materialType(f.form, g.name)] ?? 0),
      0
    );
    return {
      ...g,
      type: materialType("RUNNER_RAISER", g.name),
      label: `${g.name} Scrap`,
      quantity,
      percentage: total > 0 ? (quantity / total) * 100 : 0,
    };
  });
}
