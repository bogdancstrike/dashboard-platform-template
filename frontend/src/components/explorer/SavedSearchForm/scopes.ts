/** Who can see a saved search, in words; and the initials a person without an avatar is drawn with. */

import type { SavedSearch } from "@/api/explorer";

export type Scope = SavedSearch["scope"];

export const SCOPES: Array<{ value: Scope; label: string; help: string }> = [
  { value: "PRIVATE", label: "Private", help: "Only you can see it." },
  { value: "SHARED", label: "Shared", help: "You, plus the people you name below." },
  { value: "PUBLIC", label: "Public", help: "Everyone signed in can find and run it." },
];

/** "Ada Lovelace" → "AL". */
export function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "")).toUpperCase();
}
