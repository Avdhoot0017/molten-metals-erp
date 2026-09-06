"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--accent)] text-[var(--primary-dark)]",
        secondary:
          "bg-[var(--muted)] text-[var(--muted-foreground)]",
        success:
          "bg-[var(--success-light)] text-green-800",
        warning:
          "bg-[var(--warning-light)] text-amber-800",
        error:
          "bg-[var(--error-light)] text-red-800",
        info:
          "bg-[var(--info-light)] text-blue-800",
        outline:
          "border border-[var(--border)] text-[var(--foreground)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
