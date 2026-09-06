"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  description?: string;
  className?: string;
  iconClassName?: string;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  description,
  className,
  iconClassName,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--muted-foreground)]">
            {title}
          </p>
          <p className="text-2xl font-bold text-[var(--foreground)]">{value}</p>
          {trend && (
            <div className="flex items-center gap-1">
              {trend.isPositive ? (
                <TrendingUp className="h-4 w-4 text-[var(--success)]" />
              ) : (
                <TrendingDown className="h-4 w-4 text-[var(--error)]" />
              )}
              <span
                className={cn(
                  "text-sm font-medium",
                  trend.isPositive
                    ? "text-[var(--success)]"
                    : "text-[var(--error)]"
                )}
              >
                {trend.value}%
              </span>
              <span className="text-sm text-[var(--muted-foreground)]">
                vs last week
              </span>
            </div>
          )}
          {description && (
            <p className="text-sm text-[var(--muted-foreground)]">
              {description}
            </p>
          )}
        </div>
        <div
          className={cn(
            "p-3 rounded-lg bg-[var(--accent)]",
            iconClassName
          )}
        >
          <Icon className="h-6 w-6 text-[var(--primary)]" />
        </div>
      </div>
    </div>
  );
}
