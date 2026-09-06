import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Re-exported so pages can keep importing display helpers from one place.
 * Values are stored in grams and displayed in kg - see `lib/units.ts`.
 */
export { formatWeight } from "./units";

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function generatePONumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-${timestamp}-${random}`;
}

export function calculateScrapPercentage(
  inputWeight: number,
  outputWeight: number,
  scrapWeight: number
): number {
  if (inputWeight === 0) return 0;
  return ((inputWeight - outputWeight - scrapWeight) / inputWeight) * 100;
}

export function calculateEfficiency(
  inputWeight: number,
  outputWeight: number
): number {
  if (inputWeight === 0) return 0;
  return (outputWeight / inputWeight) * 100;
}
