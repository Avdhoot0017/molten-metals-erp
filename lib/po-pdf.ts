import { jsPDF } from "jspdf";
import { gramsToKg } from "./units";
import { gradeName } from "./ingot";
import type { AluminumType } from "@/types";

/**
 * Company profile printed on the purchase order letterhead.
 * EDIT THESE VALUES with the real Molten Metals registered details.
 */
export const COMPANY_PROFILE = {
  name: "MOLTEN METALS",
  tagline: "Aluminium Casting & Foundry Solutions",
  addressLines: [
    "Plot No. 42, MIDC Industrial Area",
    "Bhosari, Pune - 411026",
    "Maharashtra, India",
  ],
  phone: "+91 20 2712 0000",
  email: "purchase@moltenmetals.com",
  gstNumber: "27AAAAA0000A1Z5",
};

/** Aspect ratio of public/Molten.png (9135 x 4995). */
const LOGO_ASPECT = 9135 / 4995;

const BRAND = {
  gold: [184, 134, 11] as [number, number, number], // #B8860B
  goldDark: [139, 105, 20] as [number, number, number], // #8B6914
  ink: [26, 26, 26] as [number, number, number],
  muted: [110, 110, 110] as [number, number, number],
  line: [219, 219, 219] as [number, number, number],
  wash: [250, 246, 235] as [number, number, number],
};

export interface POPdfData {
  poNumber: string;
  status: string;
  createdAt: string | Date;
  expectedDate?: string | Date | null;
  deliveredDate?: string | Date | null;
  quantity: number; // grams as stored; printed in kg
  ingotType?: AluminumType; // the grade ordered, named on the line item
  pricePerKg: number;
  totalAmount: number;
  notes?: string | null;
  supplier: {
    name: string;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    gstNumber?: string | null;
  };
  user?: { name?: string | null } | null;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  IN_TRANSIT: "IN TRANSIT",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
};

function fmtDate(d?: string | Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(d));
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtNum(n: number, dp = 2): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(n);
}

/** Converts a rupee amount into Indian-system words (lakh / crore). */
export function amountInWords(amount: number): string {
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const twoDigit = (n: number): string =>
    n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + ones[n % 10] : ""}`;

  const threeDigit = (n: number): string => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return `${h ? ones[h] + " Hundred" : ""}${h && r ? " " : ""}${r ? twoDigit(r) : ""}`;
  };

  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);

  if (rupees === 0 && paise === 0) return "Zero Rupees Only";

  const parts: string[] = [];
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;

  if (crore) parts.push(`${threeDigit(crore)} Crore`);
  if (lakh) parts.push(`${threeDigit(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigit(thousand)} Thousand`);
  if (rest) parts.push(threeDigit(rest));

  let words = parts.join(" ").trim();
  if (words) words = `${words} Rupees`;
  if (paise) words = `${words ? words + " and " : ""}${twoDigit(paise)} Paise`;

  return `${words} Only`;
}

/**
 * Loads an image from the app's public folder and returns it as a PNG data URL,
 * downscaled so the PDF stays small. Browser only; returns null on failure so
 * the PDF still renders without a logo.
 */
export async function loadLogoDataUrl(
  url = "/Molten.png",
  targetWidth = 400
): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();

      // The source is ~9000px wide; embedding it raw would bloat the PDF
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = Math.round((targetWidth * image.height) / image.width);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      // The logo is placed on a white plate in the PDF, so flatten it onto
      // white here. Keeping the alpha channel would make jsPDF embed a soft
      // mask and balloon the file size.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      // JPEG compresses the photo-free wordmark well and carries no alpha
      return canvas.toDataURL("image/jpeg", 0.92);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

/**
 * Builds the purchase order PDF and returns the jsPDF document.
 * `logoDataUrl` is optional - without it the letterhead falls back to text.
 */
export function buildPurchaseOrderPdf(
  po: POPdfData,
  logoDataUrl?: string | null
): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const PW = doc.internal.pageSize.getWidth(); // 595.28
  const PH = doc.internal.pageSize.getHeight(); // 841.89
  const M = 40; // page margin
  const CW = PW - M * 2; // content width

  // ---------------------------------------------------------------- header
  doc.setFillColor(...BRAND.gold);
  doc.rect(0, 0, PW, 92, "F");
  // molten accent stripe
  doc.setFillColor(...BRAND.goldDark);
  doc.rect(0, 88, PW, 4, "F");

  if (logoDataUrl) {
    // The logo is orange and blue on transparency, which would be lost against
    // the gold band, so it sits on a white plate.
    const plateW = 132;
    const plateH = 62;
    const plateX = M;
    const plateY = 15;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(plateX, plateY, plateW, plateH, 5, 5, "F");

    const pad = 8;
    const maxW = plateW - pad * 2;
    const maxH = plateH - pad * 2;
    const ratio = LOGO_ASPECT;
    let logoW = maxW;
    let logoH = logoW / ratio;
    if (logoH > maxH) {
      logoH = maxH;
      logoW = logoH * ratio;
    }
    doc.addImage(
      logoDataUrl,
      "JPEG",
      plateX + (plateW - logoW) / 2,
      plateY + (plateH - logoH) / 2,
      logoW,
      logoH
    );
  } else {
    // Fallback letterhead when the logo could not be loaded
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.text(COMPANY_PROFILE.name, M, 42);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(COMPANY_PROFILE.tagline, M, 58);
  }

  // right-aligned company contact block
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  let hy = 26;
  for (const line of COMPANY_PROFILE.addressLines) {
    doc.text(line, PW - M, hy, { align: "right" });
    hy += 10;
  }
  doc.text(`T: ${COMPANY_PROFILE.phone}`, PW - M, hy, { align: "right" });
  doc.text(`E: ${COMPANY_PROFILE.email}`, PW - M, hy + 10, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.text(`GSTIN: ${COMPANY_PROFILE.gstNumber}`, PW - M, hy + 20, {
    align: "right",
  });

  // ------------------------------------------------------- title + PO meta
  let y = 122;
  doc.setTextColor(...BRAND.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("PURCHASE ORDER", M, y);

  // status pill (right)
  const statusText = STATUS_LABELS[po.status] ?? po.status;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const pillW = doc.getTextWidth(statusText) + 24;
  doc.setFillColor(...BRAND.wash);
  doc.setDrawColor(...BRAND.gold);
  doc.setLineWidth(0.8);
  doc.roundedRect(PW - M - pillW, y - 13, pillW, 19, 9, 9, "FD");
  doc.setTextColor(...BRAND.goldDark);
  doc.text(statusText, PW - M - pillW / 2, y, { align: "center" });

  y += 10;
  doc.setDrawColor(...BRAND.gold);
  doc.setLineWidth(1.5);
  doc.line(M, y, M + 60, y);

  // PO number / dates strip
  y += 22;
  doc.setFillColor(...BRAND.wash);
  doc.rect(M, y, CW, 34, "F");
  doc.setDrawColor(...BRAND.line);
  doc.setLineWidth(0.5);
  doc.rect(M, y, CW, 34, "S");

  const metaCells: Array<[string, string]> = [
    ["PO NUMBER", po.poNumber],
    ["ORDER DATE", fmtDate(po.createdAt)],
    ["EXPECTED DELIVERY", fmtDate(po.expectedDate)],
  ];
  const cellW = CW / metaCells.length;
  metaCells.forEach(([label, value], i) => {
    const cx = M + cellW * i + 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...BRAND.muted);
    doc.text(label, cx, y + 13);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...BRAND.ink);
    doc.text(value, cx, y + 27);
    if (i > 0) {
      doc.setDrawColor(...BRAND.line);
      doc.line(M + cellW * i, y + 6, M + cellW * i, y + 28);
    }
  });

  // ------------------------------------------------------- supplier blocks
  y += 54;
  const colW = (CW - 16) / 2;

  const boxTop = y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.goldDark);
  doc.text("SUPPLIER / VENDOR", M, y);
  doc.text("DELIVER TO", M + colW + 16, y);

  y += 8;
  doc.setDrawColor(...BRAND.line);
  doc.line(M, y, M + colW, y);
  doc.line(M + colW + 16, y, M + colW + 16 + colW, y);

  const supplierLines: string[] = [];
  if (po.supplier.contactPerson) supplierLines.push(`Attn: ${po.supplier.contactPerson}`);
  if (po.supplier.address) supplierLines.push(...doc.splitTextToSize(po.supplier.address, colW - 4));
  if (po.supplier.phone) supplierLines.push(`Phone: ${po.supplier.phone}`);
  if (po.supplier.email) supplierLines.push(`Email: ${po.supplier.email}`);
  if (po.supplier.gstNumber) supplierLines.push(`GSTIN: ${po.supplier.gstNumber}`);

  const deliverLines = [
    ...COMPANY_PROFILE.addressLines,
    `Phone: ${COMPANY_PROFILE.phone}`,
    `GSTIN: ${COMPANY_PROFILE.gstNumber}`,
  ];

  // names
  const ly = y + 15;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...BRAND.ink);
  doc.text(po.supplier.name, M, ly);
  doc.text(COMPANY_PROFILE.name, M + colW + 16, ly);

  // detail lines
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.muted);
  let ay = ly + 13;
  for (const line of supplierLines) {
    doc.text(line, M, ay);
    ay += 11;
  }
  let by = ly + 13;
  for (const line of deliverLines) {
    doc.text(line, M + colW + 16, by);
    by += 11;
  }

  y = Math.max(ay, by, boxTop + 60) + 14;

  // ------------------------------------------------------------ line items
  // Stored in grams, quoted and printed in kilograms.
  const quantityKg = gramsToKg(po.quantity);
  const poGrade = po.ingotType ? gradeName(po.ingotType) : null;
  const cols = [
    { label: "#", w: 26, align: "left" as const },
    { label: "DESCRIPTION", w: CW - 26 - 90 - 90 - 100, align: "left" as const },
    { label: "QTY (KG)", w: 90, align: "right" as const },
    { label: "RATE / KG", w: 90, align: "right" as const },
    { label: "AMOUNT (INR)", w: 100, align: "right" as const },
  ];

  // header row
  doc.setFillColor(...BRAND.gold);
  doc.rect(M, y, CW, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  let cx = M;
  for (const c of cols) {
    const tx = c.align === "right" ? cx + c.w - 8 : cx + 8;
    doc.text(c.label, tx, y + 14, { align: c.align });
    cx += c.w;
  }

  // body row
  y += 22;
  const descLines: string[] = doc.splitTextToSize(
    poGrade
      ? `Primary ${poGrade} aluminium ingot for casting operations. Composition as per the ${poGrade} specification.`
      : "Primary aluminium ingot for casting operations. Grade and composition as per agreed specification.",
    cols[1].w - 16
  );
  // 16pt title baseline + one 10pt line per description line + the weight line + padding
  const rowH = Math.max(40, 22 + descLines.length * 10 + 14);
  doc.setFillColor(252, 252, 252);
  doc.rect(M, y, CW, rowH, "F");
  doc.setDrawColor(...BRAND.line);
  doc.setLineWidth(0.5);
  doc.rect(M, y, CW, rowH, "S");

  doc.setTextColor(...BRAND.ink);
  cx = M;
  const cellVals = [
    "1",
    null, // description drawn separately (multi-line)
    fmtNum(quantityKg, 3),
    fmtMoney(po.pricePerKg),
    fmtMoney(po.totalAmount),
  ];
  cols.forEach((c, i) => {
    if (i === 1) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(poGrade ? `${poGrade} Aluminium Ingot` : "Aluminium Ingot", cx + 8, y + 16);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...BRAND.muted);
      let dy = y + 27;
      for (const l of descLines) {
        doc.text(l, cx + 8, dy);
        dy += 10;
      }
      doc.text(
        `Rate basis: ${fmtNum(quantityKg, 3)} kg at the quoted price per kg`,
        cx + 8,
        dy
      );
      doc.setTextColor(...BRAND.ink);
    } else {
      doc.setFont("helvetica", i === 4 ? "bold" : "normal");
      doc.setFontSize(9);
      const tx = c.align === "right" ? cx + c.w - 8 : cx + 8;
      doc.text(String(cellVals[i]), tx, y + 16, { align: c.align });
    }
    cx += c.w;
  });

  // ---------------------------------------------------------------- totals
  y += rowH + 12;
  const totalsW = 220;
  const totalsX = M + CW - totalsW;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.muted);
  doc.text("Subtotal", totalsX + 10, y + 4);
  doc.setTextColor(...BRAND.ink);
  doc.text(fmtMoney(po.totalAmount), M + CW - 10, y + 4, { align: "right" });

  y += 14;
  doc.setDrawColor(...BRAND.line);
  doc.line(totalsX, y, M + CW, y);

  y += 6;
  doc.setFillColor(...BRAND.gold);
  doc.rect(totalsX, y, totalsW, 28, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text("GRAND TOTAL", totalsX + 10, y + 18);
  doc.setFontSize(12);
  doc.text(`INR ${fmtMoney(po.totalAmount)}`, M + CW - 10, y + 18, { align: "right" });

  // amount in words (left of totals)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.muted);
  doc.text("AMOUNT IN WORDS", M, y - 12);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.ink);
  const wordLines = doc.splitTextToSize(amountInWords(po.totalAmount), CW - totalsW - 20);
  let wy = y + 2;
  for (const l of wordLines) {
    doc.text(l, M, wy);
    wy += 11;
  }

  y += 44;

  // ----------------------------------------------------------------- notes
  if (po.notes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...BRAND.goldDark);
    doc.text("NOTES", M, y);
    y += 6;
    doc.setDrawColor(...BRAND.line);
    doc.line(M, y, M + CW, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...BRAND.ink);
    const noteLines = doc.splitTextToSize(po.notes, CW);
    y += 13;
    for (const l of noteLines) {
      doc.text(l, M, y);
      y += 11;
    }
    y += 8;
  }

  // --------------------------------------------------------- terms + signs
  const termsY = Math.min(y, PH - 200);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.goldDark);
  doc.text("TERMS & CONDITIONS", M, termsY);
  doc.setDrawColor(...BRAND.line);
  doc.line(M, termsY + 6, M + CW, termsY + 6);

  const terms = [
    "1.  Material must conform to the agreed grade and chemical composition; test certificates are required with every consignment.",
    "2.  Delivery is to be completed on or before the expected delivery date stated above.",
    "3.  Weight will be verified at our weighbridge on receipt; billing is based on the verified net weight.",
    "4.  Material not meeting specification may be rejected and returned at the supplier's cost.",
    "5.  Invoice must quote this Purchase Order number, failing which payment may be delayed.",
  ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...BRAND.muted);
  let ty = termsY + 18;
  for (const t of terms) {
    const lines = doc.splitTextToSize(t, CW);
    for (const l of lines) {
      doc.text(l, M, ty);
      ty += 10;
    }
  }

  // signatures
  const sigY = PH - 96;
  doc.setDrawColor(...BRAND.ink);
  doc.setLineWidth(0.5);
  doc.line(M, sigY, M + 160, sigY);
  doc.line(PW - M - 160, sigY, PW - M, sigY);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.ink);
  doc.text("Supplier Acknowledgement", M, sigY + 12);
  doc.text(`For ${COMPANY_PROFILE.name}`, PW - M, sigY + 12, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.muted);
  doc.text("Signature & company seal", M, sigY + 23);
  const preparedBy = po.user?.name ? `Prepared by ${po.user.name}` : "Authorised Signatory";
  doc.text(preparedBy, PW - M, sigY + 23, { align: "right" });

  // ---------------------------------------------------------------- footer
  doc.setDrawColor(...BRAND.gold);
  doc.setLineWidth(2);
  doc.line(0, PH - 34, PW, PH - 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.muted);
  doc.text(
    "This is a computer-generated purchase order and is valid without a physical signature.",
    M,
    PH - 20
  );
  doc.text(`${po.poNumber}  |  Page 1 of 1`, PW - M, PH - 20, { align: "right" });

  return doc;
}

/** Generates and downloads the purchase order PDF, logo included. */
export async function downloadPurchaseOrderPdf(po: POPdfData): Promise<void> {
  const logo = await loadLogoDataUrl();
  const doc = buildPurchaseOrderPdf(po, logo);
  doc.save(`${po.poNumber}.pdf`);
}
