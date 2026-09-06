// Molten Metals ERP - Type Definitions

export type UserRole =
  | "ADMIN"
  | "PRODUCTION_MANAGER"
  | "FETTLING_MANAGER"
  | "ACCOUNTS";

/** Display labels and selectable list for the user roles. */
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  PRODUCTION_MANAGER: "Production Manager",
  FETTLING_MANAGER: "Fettling Manager",
  ACCOUNTS: "Accounts",
};

export const USER_ROLES = Object.keys(USER_ROLE_LABELS) as UserRole[];

/** An admin-managed fettling operation (Riser Cutting, Belt Sander, ...). */
export interface ActivityType {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export interface Employee {
  id: string;
  employeeCode: string;
  name: string;
  phone?: string | null;
  activityTypeId: string;
  activityType?: { id: string; name: string };
  isActive: boolean;
  joinedAt: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface FettlingActivity {
  id: string;
  employeeId: string;
  activityTypeId: string;
  activityType?: { id: string; name: string };
  date: string | Date;
  partId?: string | null;
  partsCompleted: number;
  notes?: string | null;
  recordedBy: string;
  createdAt: string | Date;
  employee?: { id: string; name: string; employeeCode: string };
  part?: { id: string; name: string; partCode: string } | null;
  user?: { name: string };
}

/**
 * A stock line: one alloy grade in one form. Scrap is graded like ingot -
 * see lib/ingot.ts, which owns how these names are composed and read.
 */
export type AluminumType =
  | "INGOT_LM6"
  | "INGOT_LM9"
  | "INGOT_LM25"
  | "RUNNER_RAISER_LM6"
  | "RUNNER_RAISER_LM9"
  | "RUNNER_RAISER_LM25"
  | "SPILLAGE_LM6"
  | "SPILLAGE_LM9"
  | "SPILLAGE_LM25"
  | "REJECTED_PART_LM6"
  | "REJECTED_PART_LM9"
  | "REJECTED_PART_LM25";

export type POStatus = "PENDING" | "CONFIRMED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  gstNumber?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Company {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Part {
  id: string;
  partCode: string;
  name: string;
  description?: string;
  weightPerPiece: number;
  expectedScrap: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Inventory {
  id: string;
  type: AluminumType;
  quantity: number;
  lastUpdated: Date;
}

export interface InventoryLog {
  id: string;
  type: AluminumType;
  action: "ADD" | "REMOVE" | "ADJUST";
  quantity: number;
  previousQty: number;
  newQty: number;
  reference?: string;
  referenceId?: string;
  notes?: string;
  createdBy: string;
  createdAt: Date;
  user?: User;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  orderDate: Date;
  expectedDate?: Date;
  deliveredDate?: Date;
  quantity: number;
  pricePerKg: number;
  totalAmount: number;
  status: POStatus;
  notes?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  supplier?: Supplier;
  user?: User;
}

export interface ProductionRecord {
  id: string;
  batchNumber: string;
  partId: string;
  date: Date;
  aluminumUsed: number;
  quantityProduced: number;
  goodParts: number;
  rejectedParts: number;
  runnerRaiserScrap: number;
  spillageScrap: number;
  rejectedPartScrap: number;
  totalScrap: number;
  efficiency: number;
  notes?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  part?: Part;
  user?: User;
}

export interface Dispatch {
  id: string;
  dispatchNumber: string;
  companyId: string;
  dispatchDate: Date;
  vehicleNumber?: string;
  driverName?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  company?: Company;
  items?: DispatchItem[];
}

export interface DispatchItem {
  id: string;
  dispatchId: string;
  partId: string;
  quantity: number;
  weight: number;
  part?: Part;
}

export interface DailyAnalytics {
  id: string;
  date: Date;
  ingotStock: number;
  runnerRaiserStock: number;
  spillageStock: number;
  rejectedPartStock: number;
  totalAluminumUsed: number;
  totalScrapGenerated: number;
  totalPartsProduced: number;
  totalRejectedParts: number;
  totalDispatched: number;
  totalPurchased: number;
  purchaseAmount: number;
  avgEfficiency: number;
  createdAt: Date;
}

// Dashboard Stats
export interface DashboardStats {
  totalIngot: number;
  totalRunnerRaiser: number;
  totalSpillage: number;
  totalRejectedPart: number;
  totalAluminum: number;
  todayProduction: number;
  todayScrap: number;
  avgEfficiency: number;
  pendingPOs: number;
  activeCompanies: number;
  activeParts: number;
}

// Chart Data Types
export interface ChartDataPoint {
  date: string;
  value: number;
  label?: string;
}

export interface InventoryChartData {
  date: string;
  ingot: number;
  runnerRaiser: number;
  spillage: number;
  rejectedPart: number;
}

export interface ProductionChartData {
  date: string;
  produced: number;
  rejected: number;
  efficiency: number;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Form Types
export interface CreatePartForm {
  partCode: string;
  name: string;
  description?: string;
  weightPerPiece: number;
  expectedScrap?: number;
}

export interface CreateCompanyForm {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface CreateSupplierForm {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  gstNumber?: string;
}

export interface CreatePurchaseOrderForm {
  supplierId: string;
  expectedDate?: Date;
  quantity: number;
  pricePerKg: number;
  notes?: string;
}

export interface CreateProductionForm {
  partId: string;
  aluminumUsed: number;
  quantityProduced: number;
  goodParts: number;
  rejectedParts: number;
  runnerRaiserScrap: number;
  spillageScrap: number;
  rejectedPartScrap: number;
  notes?: string;
}

export interface AdjustInventoryForm {
  type: AluminumType;
  action: "ADD" | "REMOVE";
  quantity: number;
  notes?: string;
}
