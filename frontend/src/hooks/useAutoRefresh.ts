import { useEffect, useState } from "react";

/**
 * A refresh the reader turns on, per page (§53).
 *
 * Notifications and the log tail arrive over the live channel because they are
 * *events*: the server knows when there is something to say. A list, a
 * dashboard or a job queue is not an event — it is an answer that quietly goes
 * out of date — and the honest way to keep it current is to let the person
 * watching it say how often they want it re-asked, rather than to choose a
 * number on their behalf.
 *
 * Three decisions:
 *
 * * **Off by default, unless the page is a console.** A list that refetches on
 *   a timer nobody asked for spends the database's time on a tab somebody left
 *   open and moves things under a reader trying to read them. A job queue is
 *   the exception: watching progress *is* the page, so it may open with an
 *   interval already chosen — and the reader can still turn it off, which is
 *   the part that was missing when the interval was a constant in the source.
 * * **Paused while the tab is hidden**, and refreshed once on return. A
 *   background tab polling every thirty seconds is the same waste with nobody
 *   watching it — and coming back to a stale page is exactly when a refresh
 *   *is* wanted.
 * * **Remembered per page, in the browser.** Which page a reader watches is a
 *   habit of theirs, not a setting worth a round trip; and it is per page
 *   because "refresh the job queue every thirty seconds" says nothing about
 *   whether they want the account list moving.
 */

/** What a reader may choose. `0` is off, and is the default. */
export const REFRESH_CHOICES = [0, 30, 60, 300] as const;
export type RefreshSeconds = (typeof REFRESH_CHOICES)[number];

const KEY = (page: string) => `nucleus.refresh.${page}`;

/** How a chosen interval reads. `Off` rather than `0 s`. */
export function refreshLabel(seconds: RefreshSeconds): string {
  if (seconds === 0) return "Off";
  if (seconds < 60) return `${seconds}s`;
  return seconds === 60 ? "1m" : `${Math.round(seconds / 60)}m`;
}

/**
 * The reader's stored choice for a page, or the page's own default.
 *
 * Never throws: storage can be denied outright, and a page that fails to
 * render because a preference could not be read is worse than a page that
 * forgets one.
 */
export function storedInterval(page: string, fallback: RefreshSeconds = 0): RefreshSeconds {
  try {
    const raw = window.localStorage.getItem(KEY(page));
    if (raw === null) return fallback;
    const seconds = Number(raw);
    return (REFRESH_CHOICES as readonly number[]).includes(seconds)
      ? (seconds as RefreshSeconds)
      : fallback;
  } catch {
    return fallback;
  }
}

export function useAutoRefresh({
  page,
  refresh,
  defaultSeconds = 0,
}: {
  /** The page's own key, so one page's habit is not another's. */
  page: string;
  /** Re-ask whatever this page is showing. */
  refresh: () => void;
  /** Where a page starts before the reader has said anything. */
  defaultSeconds?: RefreshSeconds;
}): {
  seconds: RefreshSeconds;
  choose: (seconds: RefreshSeconds) => void;
  /** True while the tab is hidden and the timer is therefore parked. */
  paused: boolean;
} {
  const [seconds, setSeconds] = useState<RefreshSeconds>(() =>
    storedInterval(page, defaultSeconds),
  );
  const [hidden, setHidden] = useState(() => document.visibilityState === "hidden");

  const choose = (next: RefreshSeconds) => {
    setSeconds(next);
    try {
      window.localStorage.setItem(KEY(page), String(next));
    } catch {
      /* storage denied; the choice simply does not outlive the visit */
    }
  };

  // Visibility, so the timer can be parked rather than firing into a tab
  // nobody is looking at.
  useEffect(() => {
    const onChange = () => {
      const nowHidden = document.visibilityState === "hidden";
      setHidden(nowHidden);
      // Coming back to a page that has been stale for ten minutes is exactly
      // when a refresh is worth doing — once, not once per skipped tick.
      if (!nowHidden && seconds > 0) refresh();
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
    // `refresh` is a fresh closure each render and re-subscribing on every one
    // would be pointless churn; the interval below is what depends on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  useEffect(() => {
    if (seconds === 0 || hidden) return undefined;
    const timer = window.setInterval(refresh, seconds * 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, hidden]);

  return { seconds, choose, paused: hidden && seconds > 0 };
}
