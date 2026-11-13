import type { RoleMatrix } from "@/api/roles";

export interface Cell {
  role: string;
  permission: string;
}

export const cellKey = (cell: Cell) => `${cell.role}:${cell.permission}`;

/** Permissions that may not be taken from your own role; the server agrees. */
export const SELF_LOCKOUT_GUARD = new Set(["roles.manage", "admin.access"]);

/** A permission row, or the heading of the group it belongs to. */
export interface MatrixRow {
  key: string;
  kind: "group" | "permission";
  label: string;
  permission: string;
  /** For a group heading: the codes it covers, so it can show "4/7". */
  permissions: string[];
}

/**
 * The matrix, flattened into rows with their group headings interleaved.
 *
 * A heading whose group has been filtered away is not rendered: a screen of
 * empty section titles is a worse answer than a short list.
 */
export function buildRows(data: RoleMatrix, term: string): MatrixRow[] {
  const needle = term.trim().toLowerCase();
  const rows: MatrixRow[] = [];

  for (const group of data.permissions.groups) {
    const matching = group.permissions.filter(
      (permission) =>
        !needle ||
        permission.label.toLowerCase().includes(needle) ||
        permission.code.toLowerCase().includes(needle),
    );
    if (matching.length === 0) continue;

    rows.push({
      key: `group:${group.name}`,
      kind: "group",
      label: group.name,
      permission: "",
      permissions: matching.map((permission) => permission.code),
    });
    for (const permission of matching) {
      rows.push({
        key: permission.code,
        kind: "permission",
        label: permission.label,
        permission: permission.code,
        permissions: [],
      });
    }
  }
  return rows;
}

/** The staged toggles that really change something, as the full permission list per role. */
export function pendingChanges(staged: Record<string, boolean>, data: RoleMatrix | undefined) {
  if (!data) return [];
  const byRole = new Map<string, Set<string>>();
  for (const [key, granted] of Object.entries(staged)) {
    const [code, permission] = key.split(":") as [string, string];
    const role = data.items.find((item) => item.code === code);
    if (!role) continue;
    if (role.permissions.includes(permission) === granted) continue;
    const set = byRole.get(code) ?? new Set(role.permissions);
    if (granted) set.add(permission);
    else set.delete(permission);
    byRole.set(code, set);
  }
  return [...byRole.entries()].map(([code, permissions]) => ({
    code,
    permissions: [...permissions].sort(),
  }));
}

/** How many staged toggles differ from what the roles hold now. */
export function pendingCount(staged: Record<string, boolean>, data: RoleMatrix | undefined): number {
  return Object.entries(staged).filter(([key, granted]) => {
    const [code, permission] = key.split(":") as [string, string];
    const role = data?.items.find((item) => item.code === code);
    return role ? role.permissions.includes(permission) !== granted : false;
  }).length;
}
