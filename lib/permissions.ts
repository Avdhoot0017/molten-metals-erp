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
  // Orders received FROM customers. Separate from purchaseOrders, which is us
  // buying ingot - the two are opposite directions and different desks.
  | "customerOrders"
  /*
   * What has gone out to each customer, separate from the orders it delivers
   * against. The plant needs to see that castings left - it is the other end
   * of its own finished stock - while the order behind it, with its prices
   * and tax, is the office's business. One resource could not say that.
   */
  | "customerOutward"
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
    customerOrders: WRITE,
    customerOutward: WRITE,
    purchaseOrders: WRITE,
    suppliers: WRITE,
    analytics: WRITE,
    settings: WRITE,
  },

  // Runs the plant: everything to do with melting, fettling and stock, and
  // the buying side with it. Two things are deliberately not theirs:
  //  - correcting a completed production batch, which moves stock already
  //    booked, stays with ADMIN (see canAmendCompletedBatch below);
  //  - the customer order desk. A customer PO carries prices and tax, and
  //    what has gone out against it is what the customer is billed on, so
  //    raising and delivering against orders sits with the office rather
  //    than with the plant. Customers themselves stay open to them, because
  //    the record has to exist before anything can be cast.
  PRODUCTION_MANAGER: {
    dashboard: WRITE,
    employees: WRITE,
    fettling: WRITE,
    inventory: WRITE,
    production: WRITE,
    parts: WRITE,
    companies: WRITE,
    customerOrders: NONE,
    // Sees what has gone out, without prices. See canSeeOrderMoney.
    customerOutward: READ,
    purchaseOrders: READ,
    suppliers: WRITE,
    analytics: WRITE,
    // Settings is the admin's: users, furnaces and the activity list
    settings: NONE,
  },

  // Runs the fettling shop floor. Holds inventory because the shop books
  // scrap in and out as it works.
  FETTLING_MANAGER: {
    dashboard: WRITE,
    // Runs the shop floor, so it hires and manages the people on it.
    employees: WRITE,
    fettling: WRITE,
    inventory: WRITE,
    production: WRITE,
    // The shop floor defines the parts it fettles
    parts: WRITE,
    /*
     * Customers may be added by whoever is in front of the screen when a new
     * one is taken on - it is a name and address, and the shop needs the
     * record to exist before it can cast for them. Their orders are a
     * different matter: a PO carries prices and tax, and what has been
     * delivered against it is what the customer is billed on, so both stay
     * off the shop floor.
     */
    companies: WRITE,
    customerOrders: NONE,
    // Sees what has gone out, without prices. See canSeeOrderMoney.
    customerOutward: READ,
    purchaseOrders: READ,
    suppliers: WRITE,
    analytics: WRITE,
    settings: NONE,
  },

  // Read-only across plant operations, but owns the customer desk, the users
  // and the settings
  ACCOUNTS: {
    dashboard: WRITE,
    employees: READ,
    fettling: READ,
    inventory: READ,
    production: READ,
    // Keeps the part master: codes, weights and rates all come off the
    // customer's paperwork, which is what she works from
    parts: WRITE,
    /*
     * The customer desk is hers: she takes the customer on, raises their PO
     * off their paperwork, and records what went out against it. That is her
     * job rather than the shop floor's, so these three are WRITE while
     * everything to do with melting and fettling stays read-only.
     *
     * Undoing an outward note is still ADMIN alone - see canReverseOutward.
     * Cancelling one puts castings back into finished stock, which is a
     * correction to a signed delivery note, not data entry.
     */
    companies: WRITE,
    customerOrders: WRITE,
    customerOutward: WRITE,
    purchaseOrders: WRITE,
    suppliers: WRITE,
    analytics: WRITE,
    // Users, furnaces and the activity list stay with the admin
    settings: NONE,
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

/**
 * Only an admin may add or remove SCRAP stock by hand.
 *
 * Scrap arrives and leaves through production - a heat generates it, another
 * re-melts it - so a hand adjustment is either a stock-take correction or a
 * mistake. Ingot is different: it is bought in and issued, so anyone who runs
 * the plant needs to book it.
 */
export function canAdjustScrapStock(user: RoleHolder | null | undefined) {
  return user?.role === "ADMIN";
}

/**
 * Only an admin may undo an outward note.
 *
 * Cancelling a dispatch puts pieces back into finished stock - it says
 * castings that were recorded as gone are on the shelf after all. That is a
 * correction to a signed delivery note, not data entry, and it belongs with
 * whoever answers for the stock figures. Same reasoning as amending a closed
 * batch.
 */
export function canReverseOutward(user: RoleHolder | null | undefined) {
  return user?.role === "ADMIN";
}

/**
 * Whether money may be shown to this role.
 *
 * The plant can see what went out to a customer but not what it was sold
 * for, so anything priced - a rate, a line amount, an order total - is drawn
 * only when this is true. It follows read access to the customer orders
 * themselves, because that is where the prices are kept, which means one
 * answer rather than a judgement per screen.
 */
export function canSeeOrderMoney(user: RoleHolder | null | undefined) {
  return canRead(user, "customerOrders");
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
  { prefix: "/customer-orders", resource: "customerOrders" },
  // Outward has its own access: the plant may read it, prices masked
  { prefix: "/customer-outward", resource: "customerOutward" },
  // The customers list is the companies table under the name the shop uses
  { prefix: "/customers", resource: "companies" },
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
