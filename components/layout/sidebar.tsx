"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Package,
  Boxes,
  Building2,
  ShoppingCart,
  Factory,
  BarChart3,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Users,
  HardHat,
  ClipboardList,
  Loader2,
} from "lucide-react";
import type { UserRole } from "@/types";
import { can, type Resource } from "@/lib/permissions";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  /** Visibility follows read access to this resource in lib/permissions.ts */
  resource: Resource;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, resource: "dashboard" },
  // Plant operations
  { label: "Inventory", href: "/inventory", icon: Package, resource: "inventory" },
  { label: "Production", href: "/production", icon: Factory, resource: "production" },
  { label: "Parts", href: "/parts", icon: Boxes, resource: "parts" },
  // Fettling shop
  { label: "Employees", href: "/employees", icon: HardHat, resource: "employees" },
  { label: "Fettling Activity", href: "/fettling", icon: ClipboardList, resource: "fettling" },
  // Commercial
  { label: "Companies", href: "/companies", icon: Building2, resource: "companies" },
  { label: "Purchase Orders", href: "/purchase-orders", icon: ShoppingCart, resource: "purchaseOrders" },
  { label: "Suppliers", href: "/suppliers", icon: Users, resource: "suppliers" },
  { label: "Analytics", href: "/analytics", icon: BarChart3, resource: "analytics" },
  { label: "Settings", href: "/settings", icon: Settings, resource: "settings" },
];

interface SidebarProps {
  userRole?: UserRole;
  /** Owned by DashboardShell so the main column can resize with the sidebar. */
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  userRole = "ADMIN",
  isCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

  const filteredNavItems = navItems.filter((item) =>
    can({ role: userRole }, item.resource)
  );

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
      });

      if (response.ok) {
        router.push("/login");
        router.refresh();
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen bg-[var(--sidebar-bg)] transition-all duration-300 flex flex-col",
        isCollapsed ? "w-20" : "w-64"
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          "flex items-center justify-between h-16 border-b border-[var(--sidebar-hover)]",
          isCollapsed ? "px-2" : "px-8"
        )}
      >
        {/* The logo is a wordmark, so it stands alone - no separate brand text */}
        <Link
          href="/dashboard"
          className={cn(
            "flex w-full items-center transition-opacity hover:opacity-80",
            isCollapsed ? "justify-center" : "justify-start"
          )}
        >
          <Image
            src="/Molten.png"
            alt="Molten Metal Pvt Ltd"
            width={183}
            height={100}
            priority
            className={cn(
              "object-contain",
              isCollapsed ? "h-auto w-11" : "h-11 w-auto"
            )}
          />
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        <ul className="space-y-1">
          {filteredNavItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-[var(--sidebar-active)] text-white"
                      : "text-[var(--sidebar-text-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-text)]"
                  )}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {!isCollapsed && <span>{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--sidebar-hover)] p-3">
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className={cn(
            "cursor-pointer flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
            "text-[var(--sidebar-text-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-text)]",
            isLoggingOut && "opacity-50 cursor-not-allowed"
          )}
        >
          {isLoggingOut ? (
            <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" />
          ) : (
            <LogOut className="h-5 w-5 flex-shrink-0" />
          )}
          {!isCollapsed && <span>{isLoggingOut ? "Logging out..." : "Logout"}</span>}
        </button>
      </div>

      {/* Collapse Toggle - sits on the header/nav divider */}
      <button
        onClick={onToggleCollapse}
        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!isCollapsed}
        className="absolute -right-3 top-16 z-10 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-[var(--primary)] text-white shadow-md ring-2 ring-[var(--sidebar-bg)] transition-colors hover:bg-[var(--primary-dark)]"
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </button>
    </aside>
  );
}
