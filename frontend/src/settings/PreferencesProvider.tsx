/**
 * The reader's own settings, applied everywhere without being asked for (§40).
 *
 * A preferences page that only changes what is on the preferences page is a
 * form, not a setting. What makes these preferences is that they are read by
 * the parts of the app that never mention them: the timestamp in an audit row,
 * the page size of a list nobody configured, the address the logo goes to.
 *
 * The server is the durable copy — the point of storing them there is that a
 * colleague's laptop, a second browser and a fresh profile all agree — and
 * `AuthProvider` already fetches them with the profile. This provider does
 * three things with what it finds:
 *
 * 1. publishes them to React, for the pages that read them directly;
 * 2. pushes the format settings into `lib/formats`, which the non-component
 *    formatters read (a hook cannot be called from a plain function);
 * 3. saves a change straight through to the server and updates the cached
 *    profile from the response, so nothing has to be re-fetched to see it.
 *
 * Appearance and density are *not* saved here — `AuthProvider` already owns
 * that round trip, because they are painted from localStorage before identity
 * even resolves and two writers of one field is a race. This provider reads
 * them and hands the setter through.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { meApi, type CurrentUser, type PreferencePatch, type UserPreferences } from "@/api/me";
import { useAuth } from "@/auth/AuthProvider";
import { applyFormats } from "@/lib/formats";

/** What the app falls back to before the profile has answered. */
export const PREFERENCE_DEFAULTS: UserPreferences = {
  appearance: { theme: "system", density: "middle", sidebar_collapsed: false },
  formats: { date: "YYYY-MM-DD", time: "24h", number: "1,234.56" },
  defaults: { page_size: 25, landing_page: "dashboard" },
};

interface PreferencesContextValue {
  preferences: UserPreferences;
  /** True while a change is in flight, so a page can say "saving". */
  saving: boolean;
  /** The last save that failed, if one did. */
  error: Error | null;
  save: (patch: PreferencePatch) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const preferences = profile?.preferences ?? PREFERENCE_DEFAULTS;

  const mutation = useMutation({
    mutationFn: (patch: PreferencePatch) => meApi.updatePreferences(patch),
    onSuccess: ({ preferences: saved }) => {
      // Written from the response rather than invalidated: the server has just
      // told us the whole merged document, and re-fetching it would show the
      // reader their own change arriving a second time.
      queryClient.setQueryData<CurrentUser>(["me"], (current) =>
        current ? { ...current, preferences: saved } : current,
      );
    },
  });

  // The formatters are plain functions, so they cannot subscribe to a context.
  // One writer, here, on every change to the profile.
  useEffect(() => {
    applyFormats(preferences.formats);
  }, [preferences.formats]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      preferences,
      saving: mutation.isPending,
      error: mutation.error instanceof Error ? mutation.error : null,
      save: mutation.mutate,
    }),
    [preferences, mutation.isPending, mutation.error, mutation.mutate],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used inside <PreferencesProvider>");
  return value;
}

/**
 * The default page size, for a list the reader has not paged yet.
 *
 * Read through a hook rather than from the module store because a list *is* a
 * component, and a change to this preference should re-render it rather than
 * waiting for the next navigation.
 */
export function useDefaultPageSize(): number {
  return usePreferences().preferences.defaults.page_size;
}
