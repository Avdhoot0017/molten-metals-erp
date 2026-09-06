import type { UserRole } from "@/types";

/**
 * Single source of truth for what each role may do.
 *
 * Nav visibility, route guards and every API check read from this matrix, so
 * a role's access is defined in exactly one place.
 */

export type Resource =
  | "dashboard"
  | "employees"
  | "fettling"
  | "inventory"
  | "production"
  | "parts"
  | "companies"
  | "purchaseOrders"
  | "suppliers"
  | "analytics"
  | "settings";

export type Access = "none" | "read" | "write";
export type Action = "read" | "write";

const NONE: Access = "none";
const READ: Access = "read";
const WRITE: Access = "write";

export const PERMISSIONS: Record<UserRole, Record<Resource, Access>> = {
  // Full access to everything
  ADMIN: {
    dashboard: WRITE,
    employees: WRITE,
    fettling: WRITE,
    inventory: WRITE,
    production: WRITE,
    parts: WRITE,
    companies: WRITE,
    purchaseOrders: WRITE,
    suppliers: WRITE,
    analytics: WRITE,
    settings: WRITE,
  },

  // Runs the plant. Full access, the same as ADMIN - the difference between
  // the two is not what they can reach but what they may undo: correcting a
  // completed production batch stays with ADMIN, because it moves stock that
  // has already been booked. See canAmendCompletedBatch below.
  PRODUCTION_MANAGER: {
    dashboard: WRITE,
    employees: WRITE,
    fettling: WRITE,
    inventory: WRITE,
    production: WRITE,
    parts: WRITE,
    companies: WRITE,
    purchaseOrders: WRITE,
    suppliers: WRITE,
    analytics: WRITE,
    settings: WRITE,
  },

  // Runs the fettling shop floor. Holds inventory because the shop books
  // scrap in and out as it works.
  FETTLING_MANAGER: {
    dashboard: READ,
    // Runs the shop floor, so it hires and manages the people on it.
    employees: WRITE,
    fettling: WRITE,
    inventory: WRITE,
    production: WRITE,
    // The shop floor defines the parts it fettles
    parts: WRITE,
    companies: NONE,
    purchaseOrders: NONE,
    suppliers: NONE,
    analytics: NONE,
    settings: NONE,
  },

  // Read-only across operations, but owns users and settings
  ACCOUNTS: {
    dashboard: READ,
    employees: READ,
    fettling: READ,
    inventory: READ,
    production: READ,
    parts: READ,
    companies: READ,
    purchaseOrders: READ,
    suppliers: READ,
    analytics: READ,
    settings: WRITE,
  },
};

interface RoleHolder {
  role: UserRole;
}

/** True when the role is allowed to perform `action` on `resource`. */
export function can(
  user: RoleHolder | null | undefined,
  resource: Resource,
  action: Action = "read"
): boolean {
  if (!user) return false;
  const access = PERMISSIONS[user.role]?.[resource] ?? NONE;
  if (access === NONE) return false;
  return action === "read" ? true : access === WRITE;
}

/** Convenience for API routes: read access to a resource. */
export function canRead(user: RoleHolder | null | undefined, resource: Resource) {
  return can(user, resource, "read");
}

/** Convenience for API routes: write access to a resource. */
export function canWrite(user: RoleHolder | null | undefined, resource: Resource) {
  return can(user, resource, "write");
}

/**
 * Employees are onboarded by whoever has write access, but the fettling
 * manager may additionally move an existing employee between operations.
 */
/**
 * Only an admin may reopen a batch that has already been completed.
 *
 * Completing a batch books scrap into stock, so amending one moves real
 * inventory. That is a correction, not routine data entry, and it should sit
 * with whoever answers for the stock figures.
 */
export function canAmendCompletedBatch(user: RoleHolder | null | undefined) {
  return user?.role === "ADMIN";
}

export function canReassignEmployeeTask(user: RoleHolder | null | undefined) {
  if (!user) return false;
  return canWrite(user, "employees") || user.role === "FETTLING_MANAGER";
}

/** Route path prefix -> resource, used by the middleware and the sidebar. */
export const ROUTE_RESOURCES: Array<{ prefix: string; resource: Resource }> = [
  { prefix: "/employees", resource: "employees" },
  { prefix: "/fettling", resource: "fettling" },
  { prefix: "/inventory", resource: "inventory" },
  { prefix: "/production", resource: "production" },
  { prefix: "/parts", resource: "parts" },
  { prefix: "/companies", resource: "companies" },
  { prefix: "/purchase-orders", resource: "purchaseOrders" },
  { prefix: "/suppliers", resource: "suppliers" },
  { prefix: "/analytics", resource: "analytics" },
  { prefix: "/settings", resource: "settings" },
  { prefix: "/dashboard", resource: "dashboard" },
];

/** Resource guarding a path, or null when the path is not role-gated. */
export function resourceForPath(pathname: string): Resource | null {
  return (
    ROUTE_RESOURCES.find((entry) => pathname.startsWith(entry.prefix))?.resource ??
    null
  );
}

/** The first page a role is allowed to see, used for redirects. */
export function landingPageFor(role: UserRole): string {
  return can({ role }, "dashboard") ? "/dashboard" : "/employees";
}
