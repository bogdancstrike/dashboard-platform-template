import { Tooltip } from "antd";
import { Link } from "react-router-dom";

import { PageTour } from "@/app/PageTour";
import type { NavGroup } from "@/app/navigation";
import { NxIcon, NxLogo } from "@/components/NxIcon";

import { ShellAvatar, UserMenu } from "./UserMenu";

/** The tablet layout's rail: one icon per group, the profile at the foot. */
export function TabletRail({ home, groups, currentGroupKey }: {
  home: string;
  groups: NavGroup[];
  currentGroupKey: string | undefined;
}) {
  return (
    <nav aria-label="Sections" className="nx-rail nx-glass">
      <Link to={home} aria-label="Nucleus home" className="nx-rail-logo">
        <NxLogo size={34} />
      </Link>
      {groups.map((group) => {
        const on = group.key === currentGroupKey;
        return (
          <Tooltip key={group.key} title={group.label} placement="right">
            <Link
              to={group.items[0]?.key ?? "/"}
              aria-label={group.label}
              aria-current={on ? "true" : undefined}
              className={`nx-railitem${on ? " is-on" : ""}`}
            >
              <NxIcon name={group.icon} size={20} />
            </Link>
          </Tooltip>
        );
      })}
      <span className="nx-rail-spacer" />
      <PageTour variant="rail" />
      <UserMenu placement="topLeft">
        <button className="nx-rail-me" type="button" aria-label="Open profile menu">
          <ShellAvatar size={44} />
        </button>
      </UserMenu>
    </nav>
  );
}

/** The current group's pages as chips under the tablet header. */
export function GroupChips({ group, selected }: { group: NavGroup; selected: string }) {
  return (
    <nav aria-label={group.label} className="nx-chips">
      {group.items.map((item) => (
        <Link
          key={item.key}
          to={item.key}
          aria-current={item.key === selected ? "page" : undefined}
          className={`nx-chip${item.key === selected ? " is-on" : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
