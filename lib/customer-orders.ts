/**
 * Arithmetic and wording for customer purchase orders.
 *
 * The figures on a PO are the customer's, not ours: they send a rate, a
 * quantity and the tax they worked out, and what we record has to match their
 * paperwork to the paisa or the invoice will be queried. So every amount here
 * is DERIVED THE SAME WAY THEY DERIVE IT - rate x quantity, tax as a
 * percentage of that - and the result is rounded to two decimals at each step
 * rather than once at the end, which is how a printed PO adds up.
 *
 * Everything in this file is rupees. There is no gram/kg boundary here: a PO
 * line is priced per piece, not per kilo.
 */

export const TAX_RATES = [0, 2.5, 6, 9, 14] as const;

/** Rupees, rounded the way money is: two decimals, half away from zero. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface LineFigures {
  quantity: number;
  rate: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
}

export interface LineAmounts {
  amount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  /** What this line costs in all - the line's share of the grand total. */
  lineTotal: number;
}

/** Works one line out from the four figures the customer typed. */
export function lineAmounts(line: LineFigures): LineAmounts {
  const amount = round2((line.quantity || 0) * (line.rate || 0));
  const cgstAmount = round2((amount * (line.cgstRate || 0)) / 100);
  const sgstAmount = round2((amount * (line.sgstRate || 0)) / 100);
  const igstAmount = round2((amount * (line.igstRate || 0)) / 100);
  return {
    amount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    lineTotal: round2(amount + cgstAmount + sgstAmount + igstAmount),
  };
}

export interface OrderTotals {
  subTotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  grandTotal: number;
}

/** Adds the lines up, each already rounded, exactly as the PO prints them. */
export function orderTotals(lines: LineFigures[]): OrderTotals {
  const totals = lines.reduce<OrderTotals>(
    (sum, line) => {
      const amounts = lineAmounts(line);
      return {
        subTotal: sum.subTotal + amounts.amount,
        cgstAmount: sum.cgstAmount + amounts.cgstAmount,
        sgstAmount: sum.sgstAmount + amounts.sgstAmount,
        igstAmount: sum.igstAmount + amounts.igstAmount,
        grandTotal: 0,
      };
    },
    { subTotal: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, grandTotal: 0 }
  );

  const subTotal = round2(totals.subTotal);
  const cgstAmount = round2(totals.cgstAmount);
  const sgstAmount = round2(totals.sgstAmount);
  const igstAmount = round2(totals.igstAmount);

  return {
    subTotal,
    cgstAmount,
    sgstAmount,
    igstAmount,
    grandTotal: round2(subTotal + cgstAmount + sgstAmount + igstAmount),
  };
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty",
  "Ninety",
];

/** 0-99, spelled out. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const ones = ONES[n % 10];
  return ones ? `${tens} ${ones}` : tens;
}

/** 0-999, spelled out. */
function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/**
 * A whole number in Indian words - lakh and crore, not million.
 *
 * Every PO in this trade carries the total in words, and "One Lac Fifteen
 * Thousand" is what the office expects to read back. An English-international
 * grouping would be correct arithmetic and the wrong document.
 */
export function numberInWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return "Zero";

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lac`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

/**
 * The amount as it is written on the order - "Rupees ... and Paise ... Only".
 *
 * Paise are read off the rounded figure, so the words always agree with the
 * number printed beside them.
 */
export function rupeesInWords(amount: number): string {
  const rounded = round2(Math.abs(amount));
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);

  const words = `Rupees ${numberInWords(rupees)}`;
  return paise > 0
    ? `${words} and Paise ${numberInWords(paise)} Only`
    : `${words} Only`;
}
