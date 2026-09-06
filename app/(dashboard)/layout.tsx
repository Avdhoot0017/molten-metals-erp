import { headers } from "next/headers";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import type { UserRole } from "@/types";

export default async function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = await headers();
  const userName = headersList.get("x-user-name") || "User";
  const userRole = (headersList.get("x-user-role") as UserRole) || "PRODUCTION_MANAGER";

  return (
    <DashboardShell userName={userName} userRole={userRole}>
      {children}
    </DashboardShell>
  );
}
