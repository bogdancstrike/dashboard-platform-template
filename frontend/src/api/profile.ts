import { api } from "./client";

/**
 * A person's own page, and a colleague's (§40, §41).
 *
 * Three things worth knowing before reading the types.
 *
 * **`visibility` is part of the answer, not a hint.** A colleague's page shows
 * what the directory shows and withholds the rest, and the server says *which*
 * parts it withheld — so the page can name the absence rather than render an
 * empty panel that reads as a bug (§76). The withheld fields are absent from
 * the payload rather than blank: an empty string where an address should be is
 * a thing a client will happily display.
 *
 * **`access` is the point of the page.** Role plus groups, the effective set,
 * and the part that came from a group rather than the role — the same
 * computation `/admin/users/:id` shows an administrator. Until this page
 * existed, the answer to "why can I not export?" lived only on a screen the
 * asker cannot open.
 *
 * **The analytics are dense.** Every week has a bar and every hour has a cell,
 * including the empty ones, because a chart drawn only where there is data
 * reports a quiet week as no week at all.
 */

export interface ProfilePerson {
  id: string;
  full_name: string;
  initials: string;
  username: string;
  avatar_url: string | null;
  job_title: string;
  status: string;
  /** Withheld from a reader without `users.view`, and absent rather than blank. */
  email?: string;
  phone?: string;
}

export interface ProfileNamed {
  id: string;
  name: string;
}

export interface ProfileAccess {
  role_permissions: string[];
  group_permissions: Record<string, string[]>;
  effective: string[];
  effective_labels: string[];
  /** Granted by a group and not by the role — the surprising half. */
  from_groups_only: string[];
}

export interface ProfileGroup {
  id: string;
  name: string;
  kind: string;
  permissions: string[];
}

/** One headline count, with the rows behind it (§44). */
export interface ProfileStat {
  key: string;
  label: string;
  value: number;
  link: string;
  hint?: string;
}

export interface ProfileVisibility {
  contact: boolean;
  access: boolean;
  activity: boolean;
}

export interface ProfileActivity {
  id: string;
  action: string;
  kind: string;
  resource_type: string | null;
  resource_id: string | null;
  resource_label: string | null;
  summary: string | null;
  occurred_at: string | null;
}

export interface Profile {
  is_me: boolean;
  user: ProfilePerson;
  role: { code: string | null; name: string; color: string; description: string };
  organization: ProfileNamed | null;
  department: ProfileNamed | null;
  team: ProfileNamed | null;
  manager: ProfileNamed | null;
  joined_at: string | null;
  last_login_at: string | null;
  login_count: number | null;
  locale: string;
  timezone: string;
  mfa_enabled: boolean;
  visibility: ProfileVisibility;
  groups: ProfileGroup[];
  access: ProfileAccess | null;
  stats: ProfileStat[];
  /** Tasks completed per week, one entry per week including the empty ones. */
  throughput: Array<{ bucket: string; value: number }>;
  /** Activity by weekday (0 = Monday) and hour, every cell present. */
  heatmap: Array<{ day: number; hour: number; value: number }>;
  touches: Array<{ name: string; value: number }>;
  /** Absent unless the reader may see this person's trail. */
  recent_activity?: ProfileActivity[];
}

export const profileApi = {
  /** The signed-in reader's own page. Needs no permission — see §41. */
  mine: (signal?: AbortSignal) => api.get<Profile>("/api/profile", { signal }),
  person: (userId: string, signal?: AbortSignal) =>
    api.get<Profile>(`/api/profile/${userId}`, { signal }),
};
