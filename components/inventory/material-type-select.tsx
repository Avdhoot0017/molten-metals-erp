"use client";

import * as React from "react";
import { Package, Recycle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ALLOY_GRADES,
  MATERIAL_FORMS,
  materialType,
  parseMaterialType,
} from "@/lib/ingot";
import type { AluminumType } from "@/types";

interface MaterialTypeSelectProps {
  value: AluminumType;
  onChange: (type: AluminumType) => void;
  label?: string;
  /**
   * Whether the scrap forms may be chosen. Scrap normally moves through
   * production, so booking it by hand is an admin correction - the options
   * stay visible but disabled, because hiding them would leave people
   * wondering where scrap went.
   */
  canChooseScrap?: boolean;
}

/**
 * Material picker: which alloy, then which form it is held in.
 *
 * Grade comes first because it applies to everything - scrap carries the grade
 * of the heat it came off, so LM9 spillage is its own stock line, not a
 * variant of some ungraded "spillage". Picking the grade up front means the
 * four forms below read the same way whichever alloy you are working with.
 */
export function MaterialTypeSelect({
  value,
  onChange,
  label = "Material Type",
  canChooseScrap = true,
}: MaterialTypeSelectProps) {
  const { form: selectedForm, grade: selectedGrade } = parseMaterialType(value);

  return (
    <div className="space-y-3">
      <span className="block text-sm font-medium text-[var(--foreground)]">
        {label}
      </span>

      {/* Alloy grade - applies to ingot and scrap alike */}
      <div>
        <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Alloy Grade
        </span>
        <div
          role="tablist"
          aria-label="Alloy grade"
          className="inline-flex gap-1 rounded-lg bg-[var(--muted)] p-1"
        >
          {ALLOY_GRADES.map((g) => {
            const active = selectedGrade === g.grade;
            return (
              <button
                key={g.grade}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChange(materialType(selectedForm, g.grade))}
                className={cn(
                  "cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", g.dotClass)} />
                  {g.grade}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          {ALLOY_GRADES.find((g) => g.grade === selectedGrade)?.description}
        </p>
      </div>

      {/* Form - fresh ingot, or one of the three scrap streams */}
      <div>
        <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Material Form
        </span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MATERIAL_FORMS.map((f) => {
            const type = materialType(f.form, selectedGrade);
            const active = value === type;
            const Icon = f.isScrap ? Recycle : Package;
            const blocked = f.isScrap && !canChooseScrap;

            return (
              <button
                key={f.form}
                type="button"
                disabled={blocked}
                title={
                  blocked
                    ? "Only an admin can add or remove scrap stock"
                    : undefined
                }
                onClick={() => onChange(type)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-all",
                  blocked
                    ? "cursor-not-allowed border-[var(--border)] opacity-50"
                    : "cursor-pointer",
                  active
                    ? "border-[var(--primary)] bg-[var(--accent)]"
                    : !blocked &&
                        "border-[var(--border)] hover:border-[var(--primary)]/50 hover:bg-[var(--muted)]"
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5 shrink-0",
                    active
                      ? "text-[var(--primary)]"
                      : "text-[var(--muted-foreground)]"
                  )}
                />
                <span className="min-w-0 flex-1">
                  {/* Grade is not repeated here - it is chosen directly above
                      and applies to every form in this list */}
                  <span className="block text-sm font-medium">{f.label}</span>
                  <span className="block text-xs text-[var(--muted-foreground)]">
                    {blocked ? "Only an admin can book this by hand" : f.description}
                  </span>
                </span>
                {active && (
                  <Check className="h-4 w-4 shrink-0 text-[var(--primary)]" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
