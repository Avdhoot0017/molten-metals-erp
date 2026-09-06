/**
 * Client-side Excel (.xlsx) export.
 *
 * ExcelJS is pulled in with a dynamic import so it never lands in the initial
 * bundle - it is only fetched when someone actually clicks Export.
 */

export interface ExportColumn<T> {
  header: string;
  /** Cell value for a row. Return null/undefined for a blank cell. */
  value: (row: T) => string | number | Date | null | undefined;
  width?: number;
}

export interface ExportSheet<T> {
  name: string;
  columns: ExportColumn<T>[];
  rows: T[];
}

/** Excel rejects these characters in a sheet name, and caps it at 31 chars. */
function safeSheetName(name: string): string {
  return name.replace(/[\\/*?:[\]]/g, "-").slice(0, 31) || "Sheet1";
}

/**
 * Wraps a typed sheet so a workbook can mix sheets with different row types
 * while each definition stays type-checked against its own rows.
 */
export function sheet<T>(definition: ExportSheet<T>): ExportSheet<unknown> {
  return definition as unknown as ExportSheet<unknown>;
}

/** Builds a workbook from one or more sheets and downloads it. */
export async function exportToExcel(
  filename: string,
  sheets: ExportSheet<unknown>[]
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Molten Metal ERP";
  workbook.created = new Date();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(safeSheetName(sheet.name));

    worksheet.columns = sheet.columns.map((column, index) => ({
      header: column.header,
      key: `c${index}`,
      width: column.width ?? Math.max(12, column.header.length + 4),
    }));

    for (const row of sheet.rows) {
      const record: Record<string, string | number | Date | null> = {};
      sheet.columns.forEach((column, index) => {
        record[`c${index}`] = column.value(row) ?? null;
      });
      worksheet.addRow(record);
    }

    // Header styling, in the app's brand gold
    const header = worksheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFB8860B" },
    };
    header.alignment = { vertical: "middle" };
    header.height = 20;

    // Freeze the header so long exports stay readable
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    if (sheet.rows.length > 0) {
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheet.columns.length },
      };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Pulls every page of a paginated endpoint so an export covers the whole
 * filtered result set, not just the page currently on screen.
 *
 * Endpoints do not all return a bare array - `/api/inventory` returns
 * `{ inventory, logs }` - so `select` says where the rows live. It defaults to
 * treating the payload itself as the array.
 */
export async function fetchAllPages<T>(
  path: string,
  params: Record<string, string> = {},
  options: { pageSize?: number; select?: (data: unknown) => T[] } = {}
): Promise<T[]> {
  const pageSize = options.pageSize ?? 100;
  const select =
    options.select ?? ((data: unknown) => (Array.isArray(data) ? (data as T[]) : []));

  const all: T[] = [];
  let page = 1;
  // Guard against a misbehaving endpoint looping forever
  const maxPages = 500;

  while (page <= maxPages) {
    const query = new URLSearchParams({
      ...params,
      page: String(page),
      pageSize: String(pageSize),
    });
    const response = await fetch(`${path}?${query.toString()}`);
    const result = await response.json();
    if (!result.success) break;

    const rows = select(result.data);
    if (Array.isArray(rows)) all.push(...rows);

    const meta = result.pagination;
    if (!meta || !meta.hasNext) break;
    page += 1;
  }

  return all;
}

/** `production-2026-08-30.xlsx` style filename. */
export function timestampedFilename(prefix: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `${prefix}-${stamp}.xlsx`;
}
