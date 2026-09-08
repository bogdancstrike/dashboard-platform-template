import { api } from "./client";

/**
 * Groups (§11): sets of people, and the permissions being in one adds.
 *
 * The thing to keep in mind reading these types: **there are two privileges
 * here, not one.** `can_manage_members` governs who is in a group;
 * `can_manage_grants` governs what a group *grants*. They are separate because
 * `_permissions_for` unions a group's permissions onto its members' roles, so
 * whoever may edit them may grant any permission to anybody — including
 * themselves. A manager holds the first and not the second.
 *
 * Which is why `members` and `grants` are two calls rather than fields on one
 * update: an endpoint taking both would be an endpoint needing both
 * privileges, and the page could not tell somebody which half they may use.
 *
 * Membership is sent as a **whole list**, not a delta, so a request says what
 * the group *is* and two administrators editing at once cannot interleave into
 * a state neither chose.
 *
 * See `services/groups.py`.
 */

export type GroupKind = "TEAM" | "OPERATIONAL" | "GOVERNANCE" | "BUSINESS";

export interface Group {
  id: string;
  name: string;
  /** Derived from the name — what a URL and an integration hold on to. */
  slug: string;
  description: string | null;
  kind: GroupKind;
  color: string;
  /** What being in this group adds to a member's role. */
  permissions: string[];
  member_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface GroupMember {
  id: string;
  full_name: string;
  /** From `core/naming.initials` — one rule, on the server. */
  initials: string;
  email: string;
  username: string;
  avatar_url: string | null;
  status: string;
  role_code: string | null;
  job_title: string | null;
}

export interface GroupDetail extends Group {
  members: GroupMember[];
  /** How many more there are than the detail carries. */
  member_overflow: number;
}

export interface GroupsPage {
  items: Group[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  facets: Record<string, Array<{ value: string; count: number }>>;
  columns: string[];
  can_manage_members: boolean;
  can_manage_grants: boolean;
}

export interface GroupCatalogue {
  fields: Array<{ name: string; label: string; kind: string }>;
  default_columns: string[];
  /** Every declared kind, including the ones at nought. */
  kinds: Array<{ key: GroupKind; count: number }>;
  /**
   * The permission catalogue the *code* checks for, so the grants editor
   * cannot offer one no endpoint requires.
   */
  permissions: Array<{ code: string; label: string }>;
  total: number;
  can_manage_members: boolean;
  can_manage_grants: boolean;
}

export interface GroupQuery {
  [key: string]: unknown;
  q?: string;
  kind?: string;
  page?: number;
  page_size?: number;
  sort?: string;
  order?: string;
}

export const groupsApi = {
  catalogue: (signal?: AbortSignal) =>
    api.get<GroupCatalogue>("/admin/groups/catalogue", { signal }),
  list: (params: GroupQuery = {}, signal?: AbortSignal) =>
    api.get<GroupsPage>("/admin/groups", { params, signal }),
  entry: (id: string, signal?: AbortSignal) =>
    api.get<GroupDetail>(`/admin/groups/${id}`, { signal }),
  /** Always created granting nothing, whatever is sent. */
  create: (body: { name: string; kind?: GroupKind; description?: string }) =>
    api.post<Group>("/admin/groups", body),
  /** Name, kind and description. Not permissions — see `setGrants`. */
  update: (id: string, body: Partial<{ name: string; kind: GroupKind; description: string }>) =>
    api.put<Group>(`/admin/groups/${id}`, body),
  /** The whole membership, not a delta. */
  setMembers: (id: string, userIds: string[]) =>
    api.put<Group & { added: number; removed: number }>(`/admin/groups/${id}/members`, {
      user_ids: userIds,
    }),
  /** `roles.manage`: this is granting permissions. */
  setGrants: (id: string, permissions: string[]) =>
    api.put<Group & { added: string[]; removed: string[] }>(`/admin/groups/${id}/grants`, {
      permissions,
    }),
  /** Soft-delete, and the answer says what it cost. */
  remove: (id: string) =>
    api.delete<{
      deleted: boolean;
      name: string;
      members_affected: number;
      permissions_withdrawn: string[];
    }>(`/admin/groups/${id}`),
};
