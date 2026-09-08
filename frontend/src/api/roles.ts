import { api } from "./client";

export interface PermissionEntry {
  code: string;
  label: string;
}

export interface PermissionGroup {
  name: string;
  permissions: PermissionEntry[];
}

export interface PermissionCatalogue {
  groups: PermissionGroup[];
  total: number;
}

/** One role, as it is actually in force — not as it shipped. */
export interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string;
  rank: number;
  color: string;
  is_system: boolean;
  is_default: boolean;
  permissions: string[];
  permission_labels: string[];
  user_count: number;
  /** What the seed would have written, so drift from it can be shown. */
  default_permissions: string[];
  customised: boolean;
  /** The role the caller themselves holds. */
  is_yours: boolean;
}

export interface RoleMatrix {
  items: RoleRow[];
  total: number;
  permissions: PermissionCatalogue;
  your_role: string;
}

export interface RoleUpdate {
  permissions?: string[];
  name?: string;
  description?: string;
}

/** A role an installation adds. `is_system` is never sent — the server sets it. */
export interface RoleInput {
  code: string;
  name: string;
  description?: string;
  permissions?: string[];
  color?: string;
}

export const rolesApi = {
  matrix: (signal?: AbortSignal) => api.get<RoleMatrix>("/admin/roles", { signal }),
  update: (code: string, body: RoleUpdate) => api.put<RoleRow>(`/admin/roles/${code}`, body),
  /**
   * A role of this installation's own. Never a system role: that flag protects
   * the five the seed writes, and a request that could set it could opt out of
   * the protection.
   */
  create: (body: RoleInput) => api.post<RoleRow>("/admin/roles", body),
  /** Only a role this installation added, and only when nobody holds it. */
  remove: (code: string) =>
    api.delete<{ deleted: boolean; code: string }>(`/admin/roles/${code}`),
};
