"use client";

import { cn } from "@/lib/utils";
import { LucideIcon, PackageOpen } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /**
   * What to offer instead of the missing data - usually the button that
   * creates the first one.
   *
   * Taken as a node rather than a label and a callback: every caller wants an
   * icon in that button, and a couple offer more than one action, neither of
   * which a label-plus-handler pair can express.
   */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = PackageOpen,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-4 text-center",
        className
      )}
    >
      <div className="p-4 rounded-full bg-[var(--accent)] mb-4">
        <Icon className="h-10 w-10 text-[var(--primary)]" />
      </div>
      <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-[var(--muted-foreground)] max-w-sm mb-4">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
