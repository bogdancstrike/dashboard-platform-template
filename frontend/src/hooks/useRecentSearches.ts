/**
 * The last few things this person searched for, per dataset (§4).
 *
 * Kept in the browser, not on the server. A recent search is a convenience for
 * one person at one desk, and the alternative — a table of everything everyone
 * ever typed into a search box — is a privacy liability that has to be
 * retained, exported and deleted on request. The moment recents need to follow
 * a user between machines, they belong in `/api/me/preferences` (§40) instead.
 */

import { useCallback, useEffect, useState } from "react";

import { STORAGE_KEYS } from "@/config";

/** Long enough to be useful, short enough to stay scannable in a dropdown. */
export const MAX_RECENT = 8;

export interface RecentSearches {
  terms: string[];
  remember: (term: string) => void;
  forget: (term: string) => void;
  clear: () => void;
}

export function useRecentSearches(dataset: string): RecentSearches {
  const key = `${STORAGE_KEYS.recentSearches}.${dataset}`;
  const [terms, setTerms] = useState<string[]>(() => read(key));

  // A dataset switch is a different history, not a filtered view of one.
  useEffect(() => setTerms(read(key)), [key]);

  const write = useCallback(
    (next: string[]) => {
      setTerms(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private browsing, or storage disabled: the app still works */
      }
    },
    [key],
  );

  const remember = useCallback(
    (term: string) => {
      const value = term.trim();
      if (!value) return;
      setTerms((current) => {
        // Most recent first, and one entry per term however often it is used.
        const next = [value, ...current.filter((item) => item !== value)].slice(0, MAX_RECENT);
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* as above */
        }
        return next;
      });
    },
    [key],
  );

  const forget = useCallback(
    (term: string) => write(terms.filter((item) => item !== term)),
    [terms, write],
  );

  const clear = useCallback(() => write([]), [write]);

  return { terms, remember, forget, clear };
}

function read(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}
