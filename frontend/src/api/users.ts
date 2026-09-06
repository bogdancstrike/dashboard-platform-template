import { api } from "./client";

import type { ExplorerField } from "./explorer";

/** A person as the directory lists them. */
export interface UserRow {
  id: string;
  email: string;
  username: string;
  full_name: string;
  initials: string;
  avatar_url: string | null;
  job_title: string;
  status: string;
  role_code: string | null;
  role_name: string;
  role_color: string;
  mfa_enabled: boolean;
  last_login_at: string | null;
  login_count: number;
  group_names: string[];
  created_at: string | null;
  updated_at: string | null;
}

export interface UserGroup {
  id: string;
  name: string;
  kind: string;
  permissions: string[];
}

/**
 * What a person can actually do, and how they came to be able to.
 *
 * `effective` is what the API will enforce — the role's permissions plus every
 * group's. `from_groups_only` is the half a role-shaped screen cannot explain.
 */
export interface UserAccess {
  role_permissions: string[];
  group_permissions: Record<string, string[]>;
  effective: string[];
  effective_labels: string[];
  from_groups_only: string[];
}

export interface UserSessionRow {
  id: string;
  device: string;
  ip_address: string;
  location: string;
  last_seen_at: string | null;
  revoked: boolean;
  trusted: boolean;
}

export interface SignInRow {
  id: string;
  result: string;
  reason: string;
  ip_address: string;
  location: string;
  device: string;
  method: string;
  at: string | null;
}

export interface UserDetail extends UserRow {
  phone: string;
  locale: string;
  timezone: string;
  profile_completeness: number;
  organization: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  groups: UserGroup[];
  access: UserAccess;
  sessions: UserSessionRow[];
  sign_ins: SignInRow[];
  can_manage: boolean;
  can_impersonate: boolean;
  impersonation_blocked_because: string;
}

export interface UserPage {
  items: UserRow[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  sort: string;
  order: string;
  fields: ExplorerField[];
  facets: Record<string, { value: string; count: number }[]>;
  columns: string[];
  statuses: string[];
  can_manage: boolean;
  can_impersonate: boolean;
}

export interface ImpersonationTarget {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role: string | null;
  started_by: string;
}

export interface UserQuery extends Record<string, unknown> {
  page?: number;
  page_size?: number;
  sort?: string;
  order?: "asc" | "desc";
  q?: string;
  status?: string;
  role_code?: string;
}

export const usersApi = {
  list: (params: UserQuery, signal?: AbortSignal) =>
    api.get<UserPage>("/admin/users", { params, signal }),
  get: (id: string, signal?: AbortSignal) =>
    api.get<UserDetail>(`/admin/users/${id}`, { signal }),
  update: (id: string, body: { status?: string; role_code?: string; group_ids?: string[] }) =>
    api.put<UserDetail>(`/admin/users/${id}`, body),
  /** Ask whether this impersonation is allowed, and record that it started. */
  impersonate: (id: string) =>
    api.post<ImpersonationTarget>(`/admin/users/${id}/impersonate`),
};
