"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { className, type, label, error, helperText, id, onChange, min, max, step, ...props },
    ref
  ) => {
    const inputId = id || React.useId();

    /*
     * Numbers are typed here, never stepped.
     *
     * A type="number" field can be changed three ways nobody intends: the
     * spinner arrows sit exactly where a thumb lands, the arrow keys step it
     * while someone is tabbing through a form, and the mouse wheel edits it
     * while the page is being scrolled. Every value in this app is a weight
     * off a scale or a count off a tally - a silent nudge of one is never
     * right, and nothing on screen says it happened.
     *
     * Hiding the arrows with CSS fixes only the first of the three, so the
     * field is a text box that accepts digits. inputMode keeps the numeric
     * keypad on a phone, and anything that is not a number is refused as it
     * is typed, so callers still read back a clean numeric string.
     */
    const numeric = type === "number";

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      // Empty, or digits with at most one decimal point. A half-typed "12."
      // has to pass or the point could never be entered.
      if (numeric && event.target.value !== "" && !/^\d*\.?\d*$/.test(event.target.value)) {
        return;
      }
      onChange?.(event);
    };

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-[var(--foreground)] mb-1.5"
          >
            {label}
          </label>
        )}
        <input
          type={numeric ? "text" : type}
          inputMode={numeric ? "decimal" : props.inputMode}
          // min/max/step mean nothing to a text field, so they are dropped
          // rather than rendered as attributes the browser will ignore
          {...(numeric ? {} : { min, max, step })}
          id={inputId}
          className={cn(
            "flex h-10 w-full rounded-md border bg-[var(--background)] px-3 py-2 text-sm transition-colors",
            "placeholder:text-[var(--muted-foreground)]",
            "focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-0",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error
              ? "border-[var(--error)] focus:ring-[var(--error)]"
              : "border-[var(--border)]",
            className
          )}
          ref={ref}
          onChange={handleChange}
          {...props}
        />
        {error && (
          <p className="mt-1.5 text-sm text-[var(--error)]">{error}</p>
        )}
        {helperText && !error && (
          <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
