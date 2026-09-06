/**
 * Shared server-side pagination helpers.
 *
 * Convention: a request is paginated only when it carries a `page` parameter.
 * Without it the endpoint returns the full list, which keeps callers that need
 * every row (dropdowns, selects) working unchanged.
 */

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

export interface PaginationParams {
  /** True when the caller asked for a page. */
  paginated: boolean;
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/** Reads `page` and `pageSize` from a request's query string. */
export function parsePagination(searchParams: URLSearchParams): PaginationParams {
  const rawPage = searchParams.get("page");
  const rawSize = searchParams.get("pageSize");

  const paginated = rawPage !== null;

  const parsedPage = Number.parseInt(rawPage ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const parsedSize = Number.parseInt(rawSize ?? String(DEFAULT_PAGE_SIZE), 10);
  const pageSize =
    Number.isFinite(parsedSize) && parsedSize > 0
      ? Math.min(parsedSize, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  return {
    paginated,
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

/** Builds the meta block returned alongside a page of rows. */
export function buildPaginationMeta(
  total: number,
  { page, pageSize }: { page: number; pageSize: number }
): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}
