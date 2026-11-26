/**
 * Reading the alloy master on the server.
 *
 * The grades a foundry runs are rows, not a constant: a heat charged with
 * three alloys comes out as a fourth, and that fourth has to exist as a
 * material in its own right. Every server path that needs the list comes
 * through here so there is one query shape and one ordering.
 */
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  MATERIAL_FORMS,
  materialType,
  type GradeRef,
} from "@/lib/ingot";

export const gradeSelect = {
  id: true,
  name: true,
  description: true,
  colorHex: true,
  sortOrder: true,
  isActive: true,
  canBePurchased: true,
  // The element limits a heat of this alloy is measured against
  compositionSpec: true,
} satisfies Prisma.AlloyGradeSelect;

export type GradeRow = Prisma.AlloyGradeGetPayload<{ select: typeof gradeSelect }>;

/** Oldest-configured first within the admin's own ordering. */
const gradeOrder: Prisma.AlloyGradeOrderByWithRelationInput[] = [
  { sortOrder: "asc" },
  { name: "asc" },
];

/** Every grade, including the retired ones - history still names them. */
export async function allGrades(): Promise<GradeRow[]> {
  return prisma.alloyGrade.findMany({ select: gradeSelect, orderBy: gradeOrder });
}

/** The grades that may be chosen today. */
export async function activeGrades(): Promise<GradeRow[]> {
  return prisma.alloyGrade.findMany({
    where: { isActive: true },
    select: gradeSelect,
    orderBy: gradeOrder,
  });
}

export async function gradeByName(name: string): Promise<GradeRow | null> {
  return prisma.alloyGrade.findUnique({ where: { name }, select: gradeSelect });
}

/**
 * Resolves whatever the browser sent - an id, a grade name, or a composed
 * material name like "INGOT_LM9" - to a grade row.
 *
 * Callers post all three shapes: the new pickers send ids, older screens send
 * the composed stock-line name, and imports send the plain alloy name. One
 * resolver means a mismatch is answered with "no such alloy" rather than a
 * silent default.
 */
export async function resolveGrade(
  raw: unknown,
  grades?: GradeRow[]
): Promise<GradeRow | null> {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  const pool = grades ?? (await allGrades());
  const byId = pool.find((g) => g.id === value);
  if (byId) return byId;

  const byName = pool.find((g) => g.name === value.toUpperCase());
  if (byName) return byName;

  // "INGOT_LM9" and friends: strip the form off the front
  const form = [...MATERIAL_FORMS]
    .sort((a, b) => b.form.length - a.form.length)
    .find((f) => value.startsWith(`${f.form}_`));
  if (form) {
    const name = value.slice(form.form.length + 1).toUpperCase();
    return pool.find((g) => g.name === name) ?? null;
  }
  return null;
}

/**
 * Makes sure a grade has its four stock lines, all at zero.
 *
 * Created up front rather than on first use so the inventory screen shows a
 * new alloy immediately, and so a charge can be refused for "no stock" rather
 * than "no such line". Idempotent: existing lines are left alone, quantities
 * untouched.
 */
export async function ensureStockLines(
  grade: GradeRef,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  await client.inventory.createMany({
    data: MATERIAL_FORMS.map((f) => ({
      type: materialType(f.form, grade.name),
      gradeId: grade.id,
      form: f.form,
      quantity: 0,
    })),
    skipDuplicates: true,
  });
}
