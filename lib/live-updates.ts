"use client";

import * as React from "react";

/**
 * Keeping the pages that show piece counts in step with each other.
 *
 * Three ways the figures on screen used to go stale, each needing a refresh:
 *
 *  1. Saving on the same page reloaded some of its data but not all of it -
 *     the fettling sheet came back, the station queues did not.
 *  2. Browser Back reuses the previous page as it was left (Next.js keeps it
 *     for back/forward navigation), so it never loaded again.
 *  3. A page open in another tab had no way to know anything had changed.
 *
 * Pages that change piece counts call `announcePiecesChanged()`. Pages that
 * show them call `useRefreshOnChange()`, which reloads on that announcement,
 * when the tab comes back into view, and when the browser restores the page
 * from its back/forward cache.
 */

const CHANNEL = "molten-metals:pieces";

/**
 * Tells every open tab of the app that piece counts have changed.
 *
 * The tab that made the change reloads its own data directly; this is for the
 * others. BroadcastChannel is not in every browser - where it is missing the
 * other tabs still catch up when they are next looked at, via the focus and
 * visibility listeners below, so a failure here costs freshness, not data.
 */
export function announcePiecesChanged(): void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ at: Date.now() });
    channel.close();
  } catch {
    // Unsupported or blocked - see above
  }
}

/**
 * Runs `refresh` whenever what this page shows may have changed elsewhere.
 *
 * Triggers often arrive together - switching to a tab fires both "focus" and
 * "visibilitychange" - so they are gathered into one reload rather than
 * firing two requests that race each other back.
 */
export function useRefreshOnChange(refresh: () => void | Promise<void>): void {
  // The latest callback, so the listeners are attached once and still call
  // whatever the page's current filters make `refresh` do
  const refreshRef = React.useRef(refresh);
  React.useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refreshRef.current();
      }, 150);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") schedule();
    };
    // `persisted` is true only when the browser restored the page from its
    // back/forward cache - a normal load already fetched fresh data
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) schedule();
    };

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = schedule;
    } catch {
      // Other tabs cannot tell this one directly; focus still catches it up
    }

    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      if (timer) clearTimeout(timer);
      channel?.close();
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
}

/**
 * Guards against an older request finishing after a newer one.
 *
 * Changing a filter twice quickly sends two requests; if the first is slower
 * it lands second and puts the old figures back on screen. Each call to
 * `next()` returns a ticket, and only the most recent ticket is still
 * `isLatest` when its response arrives.
 */
export function useLatestRequest() {
  const counter = React.useRef(0);
  return React.useMemo(
    () => ({
      next: () => ++counter.current,
      isLatest: (ticket: number) => ticket === counter.current,
    }),
    []
  );
}
