import { api } from "./client";

/**
 * System settings and feature flags (§11, §27).
 *
 * The thing to keep in mind reading these types: a setting **declares how it
 * should be rendered**. `value_type` and `options` are what the form reads, so
 * adding a setting on the server needs no change here at all — and a form that
 * ignored them would render a boolean as a text box and store the string
 * `"false"`, which reads as *true* everywhere it is used.
 *
 * A secret never arrives. `value` comes back as the redaction, and so does
 * `default`: a shipped secret is still a secret.
 *
 * See `services/settings.py`.
 */

export type SettingType = "string" | "integer" | "boolean" | "choice" | "json" | "duration";

export interface SettingOptions {
  choices?: Array<string | number>;
  minimum?: number;
  maximum?: number;
  /** Rendered after the field — "minutes", "days", "MB". */
  unit?: string;
}

export interface Setting {
  key: string;
  category: string;
  label: string;
  description: string | null;
  value: unknown;
  /** What the platform ships with, so drift is visible and Reset is a button. */
  default: unknown;
  value_type: SettingType;
  options: SettingOptions;
  is_secret: boolean;
  requires_restart: boolean;
  /** Whether it differs from the default. The server's answer. */
  changed: boolean;
  updated_at: string | null;
}

export interface SettingsPage {
  groups: Array<{ key: string; label: string; items: Setting[] }>;
  total: number;
  categories: Array<{ key: string; label: string; count: number }>;
  value_types: SettingType[];
  /** How many differ from what the platform ships with. */
  changed: number;
  /** Of those, how many need a restart to take effect. */
  restart_pending: number;
}

export interface FeatureFlag {
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  environment: string;
  stage: string;
  rollout_percentage: number;
  target_roles: string[];
  target_user_ids: string[];
  experimental: boolean;
  last_toggled_at: string | null;
  updated_at: string | null;
  /**
   * Whether it is on for the *reader*, computed by the same function the API
   * would gate anything with. The answer to "it is enabled but I do not have
   * it", which is the commonest question a flag screen gets.
   */
  on_for_me: boolean;
  /** Enabled, and between 1 and 99 per cent — so the number explains the row. */
  partial: boolean;
}

export interface FlagsPage {
  items: FeatureFlag[];
  total: number;
  counts: { total: number; on: number; partial: number; experimental: number };
  stages: string[];
}

export const settingsApi = {
  all: (params: { category?: string; q?: string } = {}, signal?: AbortSignal) =>
    api.get<SettingsPage>("/admin/settings", { params, signal }),
  /** One key per request, so the audit row names exactly what changed. */
  set: (key: string, value: unknown) =>
    api.put<Setting>(`/admin/settings/${key}`, { value }),
  reset: (key: string) => api.put<Setting>(`/admin/settings/${key}`, { reset: true }),

  flags: (params: { stage?: string; state?: string } = {}, signal?: AbortSignal) =>
    api.get<FlagsPage>("/admin/flags", { params, signal }),
  updateFlag: (
    key: string,
    body: Partial<{
      enabled: boolean;
      rollout_percentage: number;
      target_roles: string[];
      target_user_ids: string[];
      description: string;
      stage: string;
      experimental: boolean;
    }>,
  ) => api.put<FeatureFlag>(`/admin/flags/${key}`, body),
  /** Always created off — a flag that arrived on would ship what it guards. */
  createFlag: (body: { key: string; name: string; description?: string; stage?: string }) =>
    api.post<FeatureFlag>("/admin/flags", body),
  /** Refused while it is on. */
  removeFlag: (key: string) =>
    api.delete<{ deleted: boolean; key: string }>(`/admin/flags/${key}`),
};
