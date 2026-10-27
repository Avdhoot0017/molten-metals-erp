import { Prisma } from "@prisma/client";
import { lineAmounts, round2 } from "@/lib/customer-orders";

/**
 * Shared between the customer-order routes, so a line is validated and
 * costed in exactly one place.
 *
 * Create and update both rewrite the whole line set - an amended PO is
 * re-keyed from the paper, not patched line by line - so there is only ever
 * one way in.
 */

/** A line the form sent that cannot be recorded, with the reason why. */
export class ItemsRefused extends Error {}

/** What every read of an order returns with it. */
export const orderInclude = {
  company: {
    select: {
      id: true,
      name: true,
      contactPerson: true,
      phone: true,
      email: true,
      address: true,
      city: true,
      state: true,
      pincode: true,
      gstNumber: true,
      stateCode: true,
    },
  },
  user: { select: { name: true } },
  items: {
    orderBy: { sequence: "asc" },
    include: {
      part: { select: { id: true, partCode: true, name: true } },
    },
  },
} satisfies Prisma.CustomerOrderInclude;

/**
 * A date typed into the form, or null.
 *
 * Blank is a real answer on most of these fields - a PO often arrives with no
 * reference date - so an empty string comes back as null rather than as the
 * epoch or as today.
 */
export function parseOrderDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

export interface NormalisedItem {
  sequence: number;
  partId: string | null;
  itemCode: string;
  description: string | null;
  hsnCode: string | null;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  scheduleDate: Date | null;
  scheduleQty: number | null;
}

/**
 * Turns the form's lines into rows, costing each one here rather than
 * trusting the amounts the browser worked out.
 *
 * The totals on an order are what the office will invoice against, so they
 * are recomputed server-side from the four figures that were actually typed -
 * quantity, rate and the two tax rates. A tampered or stale amount from the
 * client cannot get in.
 */
export function normaliseItems(raw: unknown): NormalisedItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ItemsRefused("Add at least one item to the order");
  }

  return raw.map((entry, index) => {
    const line = (entry ?? {}) as Record<string, unknown>;
    const itemCode = String(line.itemCode ?? "").trim();
    if (!itemCode) {
      throw new ItemsRefused(`Item ${index + 1}: an item code is required`);
    }

    const quantity = round2(toNumber(line.quantity));
    if (quantity <= 0) {
      throw new ItemsRefused(`${itemCode}: quantity must be more than zero`);
    }

    const rate = round2(toNumber(line.rate));
    if (rate < 0) {
      throw new ItemsRefused(`${itemCode}: rate cannot be negative`);
    }

    const figures = {
      quantity,
      rate,
      cgstRate: toNumber(line.cgstRate),
      sgstRate: toNumber(line.sgstRate),
      igstRate: toNumber(line.igstRate),
    };
    const amounts = lineAmounts(figures);

    const scheduleQty = line.scheduleQty === "" || line.scheduleQty == null
      ? null
      : round2(toNumber(line.scheduleQty));

    return {
      // Renumbered from the order the lines were sent in, so deleting line 2
      // of five does not leave a gap on the printed order
      sequence: index + 1,
      partId: line.partId ? String(line.partId) : null,
      itemCode,
      description: String(line.description ?? "").trim() || null,
      hsnCode: String(line.hsnCode ?? "").trim() || null,
      quantity,
      unit: String(line.unit ?? "").trim() || "NOS",
      rate,
      amount: amounts.amount,
      cgstRate: figures.cgstRate,
      cgstAmount: amounts.cgstAmount,
      sgstRate: figures.sgstRate,
      sgstAmount: amounts.sgstAmount,
      igstRate: figures.igstRate,
      igstAmount: amounts.igstAmount,
      scheduleDate: parseOrderDate(line.scheduleDate),
      scheduleQty,
    };
  });
}
