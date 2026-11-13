import { useEffect, useRef } from "react";
import { Tooltip } from "antd";
import { Link } from "react-router-dom";

import { PageTour } from "@/app/PageTour";
import type { NavGroup } from "@/app/navigation";
import { useAuth } from "@/auth/AuthProvider";
import { useCommands } from "@/commands/CommandContext";
import { CollapseAllToggle } from "@/components/CollapseAllToggle";
import { NxIcon, NxLogo } from "@/components/NxIcon";

import { NavList } from "./NavList";
import { useClosedGroups } from "./useClosedGroups";
import type { NavCounters } from "./useNavGroups";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const CHORD = `${isMac ? "⌘" : "Ctrl "}K`;

interface SidebarProps {
  home: string;
  groups: NavGroup[];
  currentGroupKey: string | undefined;
  selected: string;
  counters: NavCounters;
  folded: boolean;
  onFold: (next: boolean) => void;
  paletteOn: boolean;
}

/** The PC layout's floating glass sidebar; it folds to an icon rail (§40). */
export function Sidebar({ home, groups, currentGroupKey, selected, counters, folded, onFold, paletteOn }: SidebarProps) {
  const auth = useAuth();
  const { setOpen: openPalette } = useCommands();
  const { closedGroups, toggleGroup, allGroupsClosed, setAllGroups } = useClosedGroups(groups, currentGroupKey);

  // Keep the current item in view when the sidebar first renders. Only on
  // arrival: scrolling on every route change would fight the reader.
  const navRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = navRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && list) list.scrollTop = Math.max(0, el.offsetTop - list.clientHeight / 2);
  }, []);

  return (
    <nav aria-label="Main" className="nx-side nx-glass">
      <div className="nx-brandrow">
        <Link to={home} className="nx-brand" aria-label="Nucleus home">
          <NxLogo size={30} />
          <span className="nx-fold-label">
            <b>Nucleus</b>
            <small>{auth.profile?.organization?.name ?? "Application template"}</small>
          </span>
        </Link>
        <button
          type="button"
          className="nx-fold"
          aria-label={folded ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!folded}
          onClick={() => onFold(!folded)}
        >
          <NxIcon name="chevronLeft" size={16} stroke={2.2} />
        </button>
      </div>
      <div className="nx-side-search">
        {paletteOn && (
          <Tooltip title={folded ? `Search or jump to… (${CHORD})` : undefined} placement="right">
            <button
              type="button"
              className="nx-omni"
              onClick={() => openPalette(true)}
              aria-label={`Open the command palette (${CHORD})`}
            >
              <NxIcon name="search" size={16} stroke={2} />
              <span>Search or jump to…</span>
              <kbd>{CHORD}</kbd>
            </button>
          </Tooltip>
        )}
        <CollapseAllToggle allCollapsed={allGroupsClosed} onToggle={setAllGroups} label="groups" />
      </div>
      {/* Held invisible until the profile says which pages this reader has:
          drawn early, the groups re-flowed as permissions and feature flags
          arrived — a 0.11 layout shift on every page load (audit A). */}
      <div className={`nx-side-menu${auth.profile ? "" : " is-pending"}`}>
        <NavList
          ref={navRef}
          groups={groups}
          selected={selected}
          folded={folded}
          closedGroups={closedGroups}
          counters={counters}
          onToggleGroup={toggleGroup}
        />
      </div>
      <PageTour variant="side" />
    </nav>
  );
}
