/**
 * The material model: every stock line is one alloy grade in one form.
 *
 * Grade is not a property of ingot alone. A runner cut off an LM6 casting is
 * still LM6 metal, and re-melting it into an LM9 heat would put the alloy out
 * of spec. So scrap carries the grade of the heat it came off, and the foundry
 * holds a separate stock line for each grade-and-form pair.
 *
 * Grade and form are encoded together in the AluminumType enum - INGOT_LM6,
 * SPILLAGE_LM9 - so one inventory table, one log and one set of queries cover
 * every material. This module is the only place that knows how that name is
 * put together or taken apart.
 */
import type { AluminumType } from "@/types";

/** LM6, LM9, LM25 - the alloys the foundry runs. */
export interface AlloyGrade {
  /** Short name as the foundry says it. */
  grade: string;
  /** The alloy spec, e.g. "AlSi12 - general casting alloy". */
  description: string;
  dotClass: string;
  /** Same colour as dotClass, for SVG charts that cannot take a class. */
  hex: string;
  /** Tint for a stat-card icon. */
  iconClass: string;
}

export const ALLOY_GRADES: AlloyGrade[] = [
  {
    grade: "LM6",
    description: "AlSi12 - general casting alloy",
    dotClass: "bg-[var(--primary)]",
    // Matches --primary, so LM6 reads as the house colour
    hex: "#B8860B",
    iconClass: "bg-amber-100",
  },
  {
    grade: "LM9",
    description: "AlSi10Mg - higher strength",
    dotClass: "bg-emerald-500",
    hex: "#10B981",
    iconClass: "bg-emerald-100",
  },
  {
    grade: "LM25",
    description: "AlSi7Mg - heat treatable",
    dotClass: "bg-violet-500",
    hex: "#8B5CF6",
    iconClass: "bg-violet-100",
  },
];

export const GRADE_NAMES = ALLOY_GRADES.map((g) => g.grade);

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
    // Unreachable for a valid enum value; keeps the return type honest
    return { form: "INGOT", grade: GRADE_NAMES[0] };
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

export function gradeSpec(grade: string): AlloyGrade {
  return ALLOY_GRADES.find((g) => g.grade === grade) ?? ALLOY_GRADES[0];
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

export const INGOT_TYPES: AluminumType[] = GRADE_NAMES.map((g) =>
  materialType("INGOT", g)
);

export const SCRAP_TYPES: AluminumType[] = SCRAP_FORMS.flatMap((f) =>
  GRADE_NAMES.map((g) => materialType(f.form, g))
);

/** Every material type, ingot grades first, in the order they should display. */
export const ALL_MATERIAL_TYPES: AluminumType[] = [
  ...INGOT_TYPES,
  ...SCRAP_TYPES,
];

/** The scrap types belonging to one grade - what an LM6 heat may re-melt. */
export function scrapTypesForGrade(grade: string): AluminumType[] {
  return SCRAP_FORMS.map((f) => materialType(f.form, grade));
}

/**
 * Ingot grade metadata in the shape the older call sites expect.
 *
 * Kept as a derived list rather than a second hand-written table so the grades
 * cannot drift apart from ALLOY_GRADES.
 */
export interface IngotGrade extends AlloyGrade {
  type: AluminumType;
  label: string;
}

export const INGOT_GRADES: IngotGrade[] = ALLOY_GRADES.map((g) => ({
  ...g,
  type: materialType("INGOT", g.grade),
  label: `${g.grade} Ingot`,
}));

export function ingotGradeFor(type: AluminumType): IngotGrade | undefined {
  return INGOT_GRADES.find((g) => g.type === type);
}

// --------------------------------------------------------------- aggregation

/** Sums the ingot lines out of a type -> quantity map. */
export function totalIngot(
  quantities: Partial<Record<AluminumType, number>>
): number {
  return INGOT_TYPES.reduce((sum, type) => sum + (quantities[type] ?? 0), 0);
}

/** Sums every scrap line out of a type -> quantity map. */
export function totalScrap(
  quantities: Partial<Record<AluminumType, number>>
): number {
  return SCRAP_TYPES.reduce((sum, type) => sum + (quantities[type] ?? 0), 0);
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
export interface IngotSlice extends AlloyGrade {
  type: AluminumType;
  label: string;
  quantity: number;
  /** Percent of the ingot total, not of all aluminium. 0 when nothing is held. */
  percentage: number;
}

/**
 * Splits an ingot figure across the three grades.
 *
 * Always returns all three rows, including grades sitting at zero: a foundry
 * needs to see that LM9 is empty, and a row that vanishes when it hits zero
 * hides exactly the fact worth knowing.
 */
export function ingotSplit(
  quantities: Partial<Record<AluminumType, number>>
): IngotSlice[] {
  const total = totalIngot(quantities);
  return INGOT_GRADES.map((grade) => {
    const quantity = quantities[grade.type] ?? 0;
    return {
      ...grade,
      quantity,
      percentage: total > 0 ? (quantity / total) * 100 : 0,
    };
  });
}

/** The same split for scrap: all three grades, every scrap form summed. */
export function scrapSplit(
  quantities: Partial<Record<AluminumType, number>>
): IngotSlice[] {
  const total = totalScrap(quantities);
  return ALLOY_GRADES.map((g) => {
    const quantity = SCRAP_FORMS.reduce(
      (sum, f) => sum + (quantities[materialType(f.form, g.grade)] ?? 0),
      0
    );
    return {
      ...g,
      type: materialType("RUNNER_RAISER", g.grade),
      label: `${g.grade} Scrap`,
      quantity,
      percentage: total > 0 ? (quantity / total) * 100 : 0,
    };
  });
}
