"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
}

const sizeClasses = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[90vw]",
};

/**
 * Number of modals currently open. Modals can nest (a picker opened from
 * inside another modal), and the scroll lock must only be released once the
 * last one closes.
 */
let openModalCount = 0;

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = "md",
}: ModalProps) {
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    if (!isOpen) return;

    document.addEventListener("keydown", handleEscape);
    openModalCount += 1;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) {
        document.body.style.overflow = "unset";
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Pull any <ModalFooter> out of children so it can render below the
  // scrolling body rather than inside it.
  const childArray = React.Children.toArray(children);
  const footerChild = childArray.find(
    (child) => React.isValidElement(child) && child.type === ModalFooter
  );
  const bodyChildren = childArray.filter((child) => child !== footerChild);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div
        className={cn(
          "relative z-50 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-lg bg-[var(--card)] shadow-lg animate-slideUp",
          sizeClasses[size]
        )}
      >
        {/* Header */}
        {(title || description) && (
          <div className="flex shrink-0 items-start justify-between border-b border-[var(--border)] p-6">
            <div>
              {title && (
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {description}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="cursor-pointer p-1 rounded-md hover:bg-[var(--muted)] transition-colors"
            >
              <X className="h-5 w-5 text-[var(--muted-foreground)]" />
            </button>
          </div>
        )}

        {/* Body - scrolls when the content is taller than the viewport */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{bodyChildren}</div>

        {/* Footer sits outside the scroll area so it is pinned flush to the
            bottom edge. A sticky footer inside the padded body can never
            reach past that padding, which leaves it floating. */}
        {footerChild}
      </div>
    </div>
  );
}

interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function ModalFooter({ children, className }: ModalFooterProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-end gap-3 border-t border-[var(--border)] bg-[var(--muted)] px-6 py-4 rounded-b-lg",
        className
      )}
    >
      {children}
    </div>
  );
}
