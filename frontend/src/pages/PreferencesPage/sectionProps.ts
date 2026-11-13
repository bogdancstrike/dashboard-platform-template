import type { UserPreferences } from "@/api/me";
import type { usePreferences } from "@/settings/PreferencesProvider";

/** What every section is handed: the reader's preferences and the save that writes one part. */
export interface SectionProps {
  preferences: UserPreferences;
  save: ReturnType<typeof usePreferences>["save"];
}
