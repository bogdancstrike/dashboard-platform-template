import { Checkbox } from "antd";

import type { PermissionGroup, RoleRow } from "@/api/roles";
import { NxIcon } from "@/components/NxIcon";

import { groupIcon } from "./roleCode";

interface PermissionPickerProps {
  groups: PermissionGroup[];
  granted: Set<string>;
  /** The role the set was copied from, while it has not been changed. */
  copiedFrom?: RoleRow;
  toggle: (codes: string[], on: boolean) => void;
}

/** What the new role grants, by area, starting from the copied role's set. */
export function PermissionPicker({ groups, granted, copiedFrom, toggle }: PermissionPickerProps) {
  const everyPermission = groups.flatMap((group) => group.permissions);
  return (
    <section className="nx-ad-perms" aria-label="Permissions">
      <header className="nx-ad-perms-head">
        <b>Permissions</b>
        <span>
          {granted.size} of {everyPermission.length} granted
          {copiedFrom ? ` · copied from ${copiedFrom.name}` : ""}
        </span>
      </header>
      {groups.map((group) => {
        const codes = group.permissions.map((permission) => permission.code);
        const held = codes.filter((code) => granted.has(code)).length;
        const all = held === codes.length;
        return (
          <div key={group.name} className="nx-ad-permgroup">
            <div className="nx-ad-permgroup-head">
              <span className="nx-ad-icon nx-ad-icon--sm" aria-hidden="true">
                <NxIcon name={groupIcon(group.name)} size={15} />
              </span>
              <b>{group.name}</b>
              <span className="nx-ad-permgroup-count">
                · {held} of {codes.length}
              </span>
              <button
                type="button"
                className="nx-ad-linkbtn"
                onClick={() => toggle(codes, !all)}
              >
                {all ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="nx-ad-permgrid">
              {group.permissions.map((permission) => (
                // The words inside the checkbox's own label: wrapped in a
                // second <label>, the input had no name at all (axe label).
                <Checkbox
                  key={permission.code}
                  className={`nx-ad-perm${granted.has(permission.code) ? " is-on" : ""}`}
                  checked={granted.has(permission.code)}
                  onChange={(event) => toggle([permission.code], event.target.checked)}
                >
                  <span className="nx-ad-perm-text">
                    <b>{permission.label}</b>
                    <code>{permission.code}</code>
                  </span>
                </Checkbox>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
