/**
 * What went into a heat.
 *
 * A charge used to be six numbers on the batch: three grades of ingot and
 * three forms of scrap of the batch's own alloy. It is now a list of lines -
 * a grade, a form and a weight each - because the foundry charges whatever it
 * has: 10 kg of LM1 ingot, 10 kg of LM2, 5 kg of LM3 spillage, and the metal
 * the last heat left in the furnace.
 *
 * What comes OUT is a separate question, and not one arithmetic can answer:
 * those three alloys together make a fourth, and which one is the melter's
 * judgement. So the result grade is declared, never computed, and everything
 * downstream - the scrap coming off, the metal left in the furnace, the next
 * heat that claims it - follows that declaration.
 *
 * One parser, shared by the create and amend routes, so an amendment cannot
 * save a charge the original form would have refused.
 */
import {
  MATERIAL_FORMS,
  SCRAP_FORMS,
  materialType,
  type MaterialForm,
} from "@/lib/ingot";
import { resolveGrade, type GradeRow } from "@/lib/grades";
import type { AluminumType } from "@/types";

export interface ChargeLine {
  grade: GradeRow;
  form: MaterialForm;
  /** Grams. Always positive - a line with nothing in it is dropped. */
  weight: number;
  /** Metal already in the furnace. Counts towards the charge, moves no stock. */
  fromHeel: boolean;
}

export interface ParsedCharge {
  lines: ChargeLine[];
  /** The alloy the operator says this heat comes out as. */
  resultGrade: GradeRow;
  /** Everything charged, heel included - what the furnace actually holds. */
  totalCharge: number;
  /** Fresh and re-melted metal that moved stock, heel excluded. */
  chargedFromStock: number;
  /** Metal carried in from the previous heat. */
  carriedIn: number;
  /** The old fixed columns, kept in step for anything still reading them. */
  legacy: {
    ingotGrade: AluminumType;
    aluminumUsed: number;
    aluminumUsedLM6: number;
    aluminumUsedLM9: number;
    aluminumUsedLM25: number;
    runnerRaiserScrapUsed: number;
    spillageScrapUsed: number;
    rejectedPartScrapUsed: number;
    totalScrapUsed: number;
  };
}

const FORM_NAMES = new Set(MATERIAL_FORMS.map((f) => f.form));

/** A refusal the caller turns into a 400 - never a server fault. */
export class ChargeRefused extends Error {}

interface RawLine {
  gradeId?: unknown;
  grade?: unknown;
  form?: unknown;
  weight?: unknown;
  fromHeel?: unknown;
}

/**
 * Reads the charge off a request.
 *
 * Accepts the new shape (`charges: [{ gradeId, form, weight }]`) and the old
 * one (`aluminumUsedLM6`, `runnerRaiserScrapUsed`, …) so a browser left open
 * on the previous version still saves a correct batch rather than an empty
 * one. Throws ChargeRefused with a sentence the operator can act on.
 */
export async function parseChargeLines(
  body: Record<string, unknown>,
  options: { carriedIn?: number; carriedInGrade?: GradeRow | null; grades?: GradeRow[] } = {}
): Promise<ParsedCharge> {
  const pool = options.grades;
  const byKey = new Map<string, ChargeLine>();

  const put = (grade: GradeRow, form: MaterialForm, weight: number, fromHeel: boolean) => {
    if (weight <= 0) return;
    const key = `${grade.id}|${form}|${fromHeel}`;
    const existing = byKey.get(key);
    // The same grade and form twice is one line, not two chances to move stock
    if (existing) existing.weight += weight;
    else byKey.set(key, { grade, form, weight, fromHeel });
  };

  const raw = Array.isArray(body.charges) ? (body.charges as RawLine[]) : null;

  if (raw) {
    for (const line of raw) {
      const weight = Number(line.weight);
      if (!Number.isFinite(weight) || weight < 0) {
        throw new ChargeRefused("Every charge line needs a weight of zero or more");
      }
      if (weight === 0) continue;

      const form = String(line.form ?? "INGOT") as MaterialForm;
      if (!FORM_NAMES.has(form)) {
        throw new ChargeRefused(`"${form}" is not a material form`);
      }

      const grade = await resolveGrade(line.gradeId ?? line.grade, pool);
      if (!grade) {
        throw new ChargeRefused("One of the charge lines names an alloy that is not on the list");
      }
      if (!grade.isActive) {
        throw new ChargeRefused(
          `${grade.name} has been retired, so it cannot be charged into a new heat`
        );
      }
      put(grade, form, weight, Boolean(line.fromHeel));
    }
  } else {
    // ---- the old shape ----------------------------------------------------
    const legacyIngot: Array<[string, unknown]> = [
      ["LM6", body.aluminumUsedLM6],
      ["LM9", body.aluminumUsedLM9],
      ["LM25", body.aluminumUsedLM25],
    ];
    for (const [name, value] of legacyIngot) {
      const weight = Number(value) || 0;
      if (weight < 0) throw new ChargeRefused(`${name} used cannot be negative`);
      if (weight === 0) continue;
      const grade = await resolveGrade(name, pool);
      if (grade) put(grade, "INGOT", weight, false);
    }

    const scrapGrade = await resolveGrade(
      body.resultGradeId ?? body.ingotGrade ?? "",
      pool
    );
    const legacyScrap: Array<[MaterialForm, unknown]> = [
      ["RUNNER_RAISER", body.runnerRaiserScrapUsed],
      ["SPILLAGE", body.spillageScrapUsed],
      ["REJECTED_PART", body.rejectedPartScrapUsed],
    ];
    for (const [form, value] of legacyScrap) {
      const weight = Number(value) || 0;
      if (weight < 0) throw new ChargeRefused("Scrap used cannot be negative");
      if (weight === 0) continue;
      if (!scrapGrade) {
        throw new ChargeRefused("Choose the alloy this scrap is being re-melted as");
      }
      put(scrapGrade, form, weight, false);
    }
  }

  // ---- the metal already in the furnace -----------------------------------
  const carriedIn = Math.max(0, options.carriedIn ?? 0);
  if (carriedIn > 0) {
    if (!options.carriedInGrade) {
      throw new ChargeRefused(
        "The metal left in the furnace has no alloy recorded, so it cannot be carried over"
      );
    }
    // Replaces any heel line the browser sent: the weight and the grade come
    // from the batch it is being taken from, never from the request
    for (const key of [...byKey.keys()]) {
      if (key.endsWith("|true")) byKey.delete(key);
    }
    put(options.carriedInGrade, "INGOT", carriedIn, true);
  }

  const lines = [...byKey.values()];
  const chargedFromStock = lines
    .filter((l) => !l.fromHeel)
    .reduce((sum, l) => sum + l.weight, 0);
  const totalCharge = chargedFromStock + carriedIn;

  if (totalCharge <= 0) {
    throw new ChargeRefused(
      "Enter the metal charged into this heat, or carry over what is left in the furnace"
    );
  }

  // ---- what it comes out as ----------------------------------------------
  const declared = await resolveGrade(
    body.resultGradeId ?? body.resultGrade ?? body.ingotGrade ?? "",
    pool
  );
  /*
   * Falls back to the heaviest line when nothing is declared.
   *
   * Only older callers reach this: the form makes the choice explicit,
   * because a heat of 10 kg LM1 and 10 kg LM2 has no arithmetic answer. The
   * fallback is the heaviest contributor, which is what the single-grade form
   * always meant.
   */
  const resultGrade =
    declared ??
    [...lines].sort((a, b) => b.weight - a.weight)[0]?.grade ??
    null;

  if (!resultGrade) {
    throw new ChargeRefused("Choose the alloy this heat comes out as");
  }
  if (!resultGrade.isActive) {
    throw new ChargeRefused(`${resultGrade.name} has been retired, so a heat cannot come out as it`);
  }

  const ingotOf = (name: string) =>
    lines
      .filter((l) => !l.fromHeel && l.form === "INGOT" && l.grade.name === name)
      .reduce((sum, l) => sum + l.weight, 0);
  const scrapOf = (form: MaterialForm) =>
    lines
      .filter((l) => !l.fromHeel && l.form === form)
      .reduce((sum, l) => sum + l.weight, 0);

  const aluminumUsed = lines
    .filter((l) => !l.fromHeel && l.form === "INGOT")
    .reduce((sum, l) => sum + l.weight, 0);
  const runnerRaiserScrapUsed = scrapOf("RUNNER_RAISER");
  const spillageScrapUsed = scrapOf("SPILLAGE");
  const rejectedPartScrapUsed = scrapOf("REJECTED_PART");

  return {
    lines,
    resultGrade,
    totalCharge,
    chargedFromStock,
    carriedIn,
    legacy: {
      ingotGrade: materialType("INGOT", resultGrade.name),
      aluminumUsed,
      aluminumUsedLM6: ingotOf("LM6"),
      aluminumUsedLM9: ingotOf("LM9"),
      aluminumUsedLM25: ingotOf("LM25"),
      runnerRaiserScrapUsed,
      spillageScrapUsed,
      rejectedPartScrapUsed,
      totalScrapUsed:
        runnerRaiserScrapUsed + spillageScrapUsed + rejectedPartScrapUsed,
    },
  };
}

/** The stock line each charge line comes out of, heel lines excluded. */
export function stockDemand(lines: ChargeLine[]): Map<AluminumType, number> {
  const demand = new Map<AluminumType, number>();
  for (const line of lines) {
    if (line.fromHeel) continue;
    const type = materialType(line.form, line.grade.name);
    demand.set(type, (demand.get(type) ?? 0) + line.weight);
  }
  return demand;
}

/** "LM1 ingot 10 kg, LM3 spillage 5 kg" - for messages and summaries. */
export function describeCharge(lines: ChargeLine[]): string {
  const formLabel = (form: MaterialForm) =>
    MATERIAL_FORMS.find((f) => f.form === form)?.label ?? form;
  return lines
    .map(
      (l) =>
        `${l.grade.name} ${formLabel(l.form).toLowerCase()}${l.fromHeel ? " (carried over)" : ""}`
    )
    .join(", ");
}

export const SCRAP_FORM_NAMES = SCRAP_FORMS.map((f) => f.form);
