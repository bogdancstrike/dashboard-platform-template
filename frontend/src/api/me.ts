import { api } from "./client";

export type AppearancePreference = "light" | "dark" | "system";
export type DensityPreference = "compact" | "middle" | "comfortable";

export interface UserPreferences {
  appearance: {
    theme: AppearancePreference;
    density: DensityPreference;
    sidebar_collapsed: boolean;
  };
  formats: {
    date: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
    time: "24h" | "12h";
    number: "1 234,56" | "1,234.56";
  };
  defaults: {
    page_size: 10 | 25 | 50 | 100;
    landing_page: string;
  };
}

export interface CurrentUser {
  user: {
    id: string;
    email: string;
    username: string;
    full_name: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    initials: string;
    phone: string | null;
    job_title: string | null;
    status: string;
    locale: string;
    timezone: string;
    joined_at: string;
    last_seen_at: string | null;
    profile_completeness: number;
    mfa_enabled: boolean;
  };
  role: {
    code: string;
    name: string;
    description: string | null;
    color: string;
  };
  organization: { id: string; name: string; slug: string } | null;
  department: { id: string; name: string; code: string } | null;
  team: { id: string; name: string; slug: string } | null;
  groups: string[];
  permissions: string[];
  preferences: UserPreferences;
  session: {
    id: string;
    impersonating: boolean;
    impersonator_id: string | null;
    impersonator_label: string | null;
  };
}

export type PreferencePatch = {
  [Section in keyof UserPreferences]?: Partial<UserPreferences[Section]>;
};

export const meApi = {
  get: (signal?: AbortSignal) => api.get<CurrentUser>("/api/me", { signal }),
  updatePreferences: (preferences: PreferencePatch, signal?: AbortSignal) =>
    api.put<{ preferences: UserPreferences }>("/api/me", { preferences }, { signal }),
};
