"use client";

import * as React from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types";

interface DashboardShellProps {
  userName: string;
  userRole: UserRole;
  children: React.ReactNode;
}

/**
 * Holds the sidebar's collapsed state so the main column can shrink with it.
 * The route layout is a server component, so the state has to live here.
 */
export function DashboardShell({
  userName,
  userRole,
  children,
}: DashboardShellProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  return (
    <div className="min-h-screen bg-[var(--muted)]">
      <Sidebar
        userRole={userRole}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed((open) => !open)}
      />

      {/* Padding tracks the sidebar width so collapsing reclaims the space */}
      <div
        className={cn(
          "transition-all duration-300",
          isCollapsed ? "pl-20" : "pl-64"
        )}
      >
        <Header title="Dashboard" userName={userName} userRole={userRole} />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
