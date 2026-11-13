import { Link, useLocation } from "react-router-dom";

import type { NavGroup } from "@/app/navigation";
import { NxIcon } from "@/components/NxIcon";

import type { NavCounters } from "./useNavGroups";

/** The bottom tab bar on a phone (design "Nucleus app shell", phone). */
const TABS: { label: string; icon: "home" | "search" | "check" | "inbox"; to: string; owns: string[] }[] = [
  { label: "Home", icon: "home", to: "/home", owns: ["/home", "/dashboard", "/dashboards", "/activity", "/announcements"] },
  { label: "Search", icon: "search", to: "/explore", owns: ["/explore", "/find", "/favorites"] },
  { label: "Work", icon: "check", to: "/tasks", owns: ["/tasks", "/kanban", "/workflows", "/calendar", "/files"] },
  { label: "Inbox", icon: "inbox", to: "/mail", owns: ["/mail", "/notifications"] },
];

export function PhoneTabs({ counters, sheetOpen, onOpenSheet }: {
  counters: NavCounters;
  sheetOpen: boolean;
  onOpenSheet: () => void;
}) {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Main" className="nx-tabs nx-glass nx-glass--strong">
      {TABS.map((tab) => {
        const on = tab.owns.some((p) => pathname === p || pathname.startsWith(`${p}/`));
        return (
          <Link key={tab.label} to={tab.to} aria-current={on ? "page" : undefined} className={`nx-tab${on ? " is-on" : ""}`}>
            <NxIcon name={tab.icon} size={20} />
            {tab.label}
            {tab.label === "Inbox" && counters["unread"] ? <b className="nx-tabbadge">{counters["unread"]}</b> : null}
          </Link>
        );
      })}
      <button
        type="button"
        className={`nx-tab${sheetOpen ? " is-on" : ""}`}
        aria-expanded={sheetOpen}
        aria-label="More navigation"
        onClick={onOpenSheet}
      >
        <NxIcon name="more" size={20} />
        More
      </button>
    </nav>
  );
}

/** The phone's "More" sheet: the whole navigation, grouped. */
export function PhoneSheet({ groups, selected, onClose }: {
  groups: NavGroup[];
  selected: string;
  onClose: () => void;
}) {
  return (
    <div className="nx-sheet-scrim" onClick={onClose}>
      <div
        className="nx-sheet nx-glass nx-glass--strong"
        role="dialog"
        aria-label="Navigation"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nx-sheet-head">
          <b>Everything</b>
          <button type="button" className="nx-iconbtn" aria-label="Close navigation" onClick={onClose}>
            <NxIcon name="close" />
          </button>
        </div>
        {groups.map((group) => (
          <section key={group.key} className="nx-sheet-group">
            <h2>{group.label}</h2>
            <div>
              {group.items.map((item) => (
                <Link
                  key={item.key}
                  to={item.key}
                  className={`nx-sheet-item${item.key === selected ? " is-on" : ""}`}
                  aria-current={item.key === selected ? "page" : undefined}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
