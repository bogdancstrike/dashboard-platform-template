import { forwardRef } from "react";
import { Tooltip } from "antd";
import { Link } from "react-router-dom";

import type { NavGroup, NavItem } from "@/app/navigation";
import { NxIcon } from "@/components/NxIcon";

import type { NavCounters } from "./useNavGroups";

interface NavListProps {
  groups: NavGroup[];
  selected: string;
  folded: boolean;
  closedGroups: string[];
  counters: NavCounters;
  onToggleGroup: (key: string) => void;
}

function NavLink({ item, on, folded, hidden, count }: {
  item: NavItem;
  on: boolean;
  folded: boolean;
  hidden: boolean;
  count: number | undefined;
}) {
  const link = (
    <Link
      to={item.key}
      aria-current={on ? "page" : undefined}
      aria-label={folded ? item.label : undefined}
      className={`nx-navitem${on ? " is-on" : ""}${item.badge === "failed_jobs" ? " is-bad" : ""}`}
      tabIndex={hidden ? -1 : 0}
    >
      {item.icon}
      <span className="nx-fold-label">{item.label}</span>
      {count ? <b className="nx-navbadge">{count > 99 ? "99+" : count}</b> : null}
    </Link>
  );
  return folded ? (
    <Tooltip title={item.label} placement="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

/** The sidebar's grouped navigation; groups fold, and the rail shows icons only. */
export const NavList = forwardRef<HTMLDivElement, NavListProps>(function NavList(
  { groups, selected, folded, closedGroups, counters, onToggleGroup },
  ref,
) {
  const showLabels = !folded;
  return (
    <div className="nx-side-scroll" ref={ref}>
      {groups.map((group) => {
        const closed = showLabels && closedGroups.includes(group.key);
        return (
          <div key={group.key} className="nx-group" role="group" aria-label={group.label}>
            <button
              type="button"
              className="nx-grouphead"
              aria-expanded={!closed}
              onClick={() => onToggleGroup(group.key)}
              tabIndex={showLabels ? 0 : -1}
            >
              <span>{group.label}</span>
              <span className="nx-grouphead-meta">
                {closed && group.items.length}
                <NxIcon name="chevronDown" size={12} stroke={2.4} className={closed ? "is-rot" : undefined} />
              </span>
            </button>
            <div className={`nx-group-items${closed ? " is-closed" : ""}`}>
              <div>
                {group.items.map((item) => (
                  <NavLink
                    key={item.key}
                    item={item}
                    on={item.key === selected}
                    folded={folded}
                    hidden={closed}
                    count={item.badge ? counters[item.badge] : undefined}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});
