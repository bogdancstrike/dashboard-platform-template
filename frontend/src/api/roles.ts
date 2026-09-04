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

export const rolesApi = {
  matrix: (signal?: AbortSignal) => api.get<RoleMatrix>("/admin/roles", { signal }),
  update: (code: string, body: RoleUpdate) => api.put<RoleRow>(`/admin/roles/${code}`, body),
};
