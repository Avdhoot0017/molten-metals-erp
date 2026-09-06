"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, User, ChevronDown, Loader2 } from "lucide-react";
import { USER_ROLE_LABELS, type UserRole } from "@/types";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface HeaderProps {
  title: string;
  userName?: string;
  userRole?: UserRole;
}

export function Header({ title, userName = "Admin User", userRole = "ADMIN" }: HeaderProps) {
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = React.useState(false);
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

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

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".user-menu-container")) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-30 bg-[var(--background)] border-b border-[var(--border)]">
      <div className="flex items-center justify-between h-16 px-6">
        {/* Title */}
        <h1 className="text-xl font-semibold text-[var(--foreground)]">{title}</h1>

        {/* Right Side */}
        <div className="flex items-center gap-4">
          {/* Notifications */}
          <button className="cursor-pointer relative p-2 rounded-lg hover:bg-[var(--muted)] transition-colors">
            <Bell className="h-5 w-5 text-[var(--muted-foreground)]" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-[var(--error)] rounded-full" />
          </button>

          {/* User Menu */}
          <div className="relative user-menu-container">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="cursor-pointer flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--muted)] transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-[var(--primary)] flex items-center justify-center">
                <User className="h-4 w-4 text-white" />
              </div>
              <div className="hidden md:block text-left">
                <p className="text-sm font-medium text-[var(--foreground)]">
                  {userName}
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {USER_ROLE_LABELS[userRole]}
                </p>
              </div>
              <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
            </button>

            {/* Dropdown Menu */}
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-lg py-1 animate-fadeIn">
                {can({ role: userRole }, "settings") && (
                  <a
                    href="/settings"
                    className="block px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
                  >
                    Settings
                  </a>
                )}
                <a
                  href="/profile"
                  className="block px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
                >
                  Profile
                </a>
                <hr className="my-1 border-[var(--border)]" />
                <button
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className={cn(
                    "cursor-pointer flex items-center gap-2 w-full text-left px-4 py-2 text-sm text-[var(--error)] hover:bg-[var(--muted)]",
                    isLoggingOut && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isLoggingOut && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isLoggingOut ? "Logging out..." : "Logout"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
