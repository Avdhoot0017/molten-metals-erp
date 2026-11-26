"use client";

import * as React from "react";
import type { GradeRef } from "@/lib/ingot";

/** A grade as the master holds it, in the shape the screens need. */
export interface GradeOption extends GradeRef {
  isActive: boolean;
  canBePurchased: boolean;
  /** Element limits for the assay, or null when none have been entered. */
  compositionSpec?: unknown;
}

/**
 * The alloys this foundry runs, read from the master.
 *
 * Every screen that offers a grade - stock, parts, the charge form, purchase
 * orders - gets the list from here rather than from a constant, because the
 * admin maintains it in Settings and a heat may come out as an alloy that did
 * not exist last week.
 *
 * `activeOnly` is for pickers: a retired grade still has to be drawn on old
 * records, so reports ask for everything.
 */
export function useGrades(options: { activeOnly?: boolean } = {}) {
  const { activeOnly = false } = options;
  const [grades, setGrades] = React.useState<GradeOption[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(
        `/api/alloy-grades${activeOnly ? "?activeOnly=true" : ""}`
      );
      const payload = await res.json();
      if (payload.success) {
        setGrades(payload.data ?? []);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      // A failed read leaves the pickers empty rather than guessing at a list
      setFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [activeOnly]);

  React.useEffect(() => {
    load();
  }, [load]);

  const active = React.useMemo(
    () => grades.filter((g) => g.isActive),
    [grades]
  );

  return { grades, active, isLoading, failed, reload: load };
}
