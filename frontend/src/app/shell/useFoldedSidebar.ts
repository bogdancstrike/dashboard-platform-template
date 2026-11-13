import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/auth/AuthProvider";
import { STORAGE_KEYS } from "@/config";
import { usePreferences } from "@/settings/PreferencesProvider";

/**
 * Whether the PC sidebar is folded to its icon rail.
 *
 * Remembered in this browser for the first paint, then the account's
 * preference wins once when the profile arrives (§40). Folding is a decision,
 * and decisions are preferences, so choosing saves it to the account.
 */
export function useFoldedSidebar() {
  const auth = useAuth();
  const { preferences, save: savePreference } = usePreferences();
  const [folded, setFolded] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === "true";
    } catch {
      return false;
    }
  });

  const preferenceApplied = useRef(false);
  useEffect(() => {
    if (preferenceApplied.current || !auth.profile) return;
    preferenceApplied.current = true;
    setFolded(auth.profile.preferences.appearance.sidebar_collapsed);
  }, [auth.profile]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, String(folded));
    } catch {
      /* storage disabled */
    }
  }, [folded]);

  const chooseFolded = (next: boolean) => {
    setFolded(next);
    if (next !== preferences.appearance.sidebar_collapsed) {
      savePreference({ appearance: { sidebar_collapsed: next } });
    }
  };

  return { folded, chooseFolded };
}
