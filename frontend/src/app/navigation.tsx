import type { ReactNode } from "react";
import { NxIcon, type NxIconName } from "@/components/NxIcon";
import { PlanIcon } from "@/components/planning/planIcons";
import { AstIcon } from "@/components/assistant/AstIcon";
import { KnIcon } from "@/components/knowledge/KnIcon";

/**
 * The navigation, grouped by what somebody came here to do rather than by the
 * data model (§1).
 *
 * Two properties matter beyond the labels:
 *
 * * **Permission-aware.** An item names the permission it needs; the shell
 *   hides what the signed-in role cannot reach, rather than showing it and
 *   answering with a 403. A menu full of dead ends teaches people to distrust
 *   the menu.
 * * **Badge-aware.** An item can name a counter that rides along on the
 *   `/api/me/counts` poll, so "12 waiting on you" is visible without opening
 *   the page.
 * * **Flag-aware.** An item can name a feature flag (§27), and the shell hides
 *   it when that flag is off for this reader. `experimental` used to be a
 *   boolean here with no source of truth behind it — a marking that said "this
 *   is new" and connected to nothing, while a whole flag screen sat in
 *   administration changing nothing at all.
 */
export interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  /** Permission required to see it at all. Absent means everyone. */
  permission?: string;
  /** Which counter from the badge poll rides along. */
  badge?: string;
  /**
   * The feature flag this item is behind (§27).
   *
   * Off means the item is not in the menu *and* the route is not reachable —
   * a menu that hides a page whose address still works is a menu somebody
   * routes around. A flag gates a feature; it never gates administration, so
   * nothing under Administration names one.
   */
  flag?: string;
  /** Marks a feature still behind a flag (§1, §27). */
  experimental?: boolean;
  disabled?: boolean;
}

export interface NavGroup {
  key: string;
  label: string;
  /** The rail's icon for the whole group (tablet widths). */
  icon: NxIconName;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "overview",
    icon: "home",
    label: "Overview",
    items: [
      // First, and above the dashboard, because it is where arriving with no
      // preference lands: a navigation whose first item is not the default
      // landing page is a navigation that disagrees with the logo.
      { key: "/home", label: "Home", icon: <NxIcon name="home" /> },
      { key: "/dashboard", label: "Dashboard", icon: <NxIcon name="gauge" /> },
      { key: "/dashboards", label: "My dashboards", icon: <NxIcon name="layout" />, permission: "dashboards.manage", flag: "dashboard-builder" },
      { key: "/activity", label: "Activity", icon: <NxIcon name="activity" /> },
      { key: "/notifications", label: "Notifications", icon: <NxIcon name="bell" />, badge: "unread" },
      { key: "/announcements", label: "Announcements", icon: <NxIcon name="megaphone" /> },
    ],
  },
  {
    // The AI features (§41–46). Shared by both AI workstreams: Insights and
    // Ask your documents join the assistant here.
    key: "ai",
    icon: "star",
    label: "AI",
    items: [
      { key: "/assistant", label: "Assistant", icon: <AstIcon name="spark" size={18} />, permission: "ai.use" },
      { key: "/ai/documents", label: "Ask your documents", icon: <KnIcon name="documents" size={18} />, permission: "ai.use" },
      { key: "/ai/insights", label: "Insights", icon: <KnIcon name="insights" size={18} />, permission: "ai.use" },
    ],
  },
  {
    key: "find",
    icon: "search",
    label: "Find",
    items: [
      // Saved searches are a *module of* the Data Explorer, not a page of their
      // own — you open one from the explorer and it loads there, the way
      // gif_responder's SavedSearchControls works. A separate destination would
      // mean two places that both claim to be where searches live.
      { key: "/explore", label: "Data Explorer", icon: <NxIcon name="search" />, permission: "records.view" },
      { key: "/find/global", label: "Global search", icon: <NxIcon name="globe" />, permission: "records.view" },
      { key: "/find/relationships", label: "Relationships", icon: <NxIcon name="graph" />, permission: "records.view" },
      { key: "/find/catalog", label: "Data catalog", icon: <NxIcon name="database" />, permission: "records.view" },
      { key: "/favorites", label: "Favorites", icon: <NxIcon name="heart" /> },
    ],
  },
  {
    key: "analyse",
    icon: "bars",
    label: "Analyse",
    items: [
      { key: "/analytics", label: "Analytics", icon: <NxIcon name="area" />, permission: "records.view" },
      { key: "/reports", label: "Reports", icon: <NxIcon name="bars" />, permission: "reports.view" },
      { key: "/reports/builder", label: "Report builder", icon: <NxIcon name="report" />, permission: "reports.manage" },
      { key: "/charts/builder", label: "Chart builder", icon: <NxIcon name="pen" />, permission: "reports.manage" },
      { key: "/maps", label: "Maps", icon: <NxIcon name="globe" /> },
    ],
  },
  {
    key: "work",
    icon: "check",
    label: "Work",
    items: [
      { key: "/tasks", label: "Tasks", icon: <NxIcon name="check" />, permission: "tasks.view", badge: "my_tasks" },
      { key: "/kanban", label: "Kanban boards", icon: <NxIcon name="kanban" />, permission: "tasks.view", flag: "kanban-board" },
      { key: "/sprints", label: "Sprints", icon: <PlanIcon name="sprint" />, permission: "tasks.view" },
      { key: "/timeline", label: "Timeline", icon: <PlanIcon name="timeline" />, permission: "tasks.view" },
            // `automations.manage` and not `tasks.manage`: a rule's condition quotes
      // the fields and values of records its reader may have no other way to
      // see, so reading the list is privileged — and an operator who triages
      // tasks is not somebody who may make the platform email forty people.
      {
        key: "/workflows",
        label: "Workflows",
        icon: <NxIcon name="flow" />,
        permission: "automations.manage",
      },
      { key: "/calendar", label: "Calendar", icon: <NxIcon name="calendar" />, permission: "calendar.view" },
      { key: "/mail", label: "Mail", icon: <NxIcon name="mail" />, permission: "mail.access", badge: "unread_mail" },
      { key: "/files", label: "Files", icon: <NxIcon name="folder" />, permission: "files.view" },
    ],
  },
  {
    key: "records",
    icon: "briefcase",
    label: "Records",
    items: [
      { key: "/projects", label: "Projects", icon: <NxIcon name="briefcase" />, permission: "records.view" },
      { key: "/customers", label: "Customers", icon: <NxIcon name="store" />, permission: "records.view" },
      { key: "/orders", label: "Orders", icon: <NxIcon name="cart" />, permission: "records.view" },
      { key: "/tickets", label: "Tickets", icon: <NxIcon name="ticket" />, permission: "records.view", badge: "open_tickets" },
      { key: "/devices", label: "Devices", icon: <NxIcon name="device" />, permission: "records.view" },
    ],
  },
  {
    key: "admin",
    icon: "shield",
    label: "Administration",
    items: [
      { key: "/admin", label: "Overview", icon: <NxIcon name="sliders" />, permission: "admin.access" },
      { key: "/admin/users", label: "Users", icon: <NxIcon name="user" />, permission: "users.view" },
      { key: "/admin/groups", label: "Groups", icon: <NxIcon name="team" />, permission: "users.view" },
      { key: "/admin/roles", label: "Roles & permissions", icon: <NxIcon name="shield" />, permission: "roles.manage" },
      // `users.view` and not `orgs.manage`: reading where people sit is
      // directory information, and this permission is what gates the *route*
      // as well as the menu entry — declaring the write permission here would
      // make the page's own read-only state unreachable. The commercial
      // fields are withheld by the service instead.
      { key: "/admin/organizations", label: "Organizations", icon: <NxIcon name="org" />, permission: "users.view" },
      { key: "/admin/audit", label: "Audit log", icon: <NxIcon name="audit" />, permission: "audit.view" },
      { key: "/admin/logs", label: "System logs", icon: <NxIcon name="logs" />, permission: "logs.view" },
      { key: "/admin/jobs", label: "Background jobs", icon: <NxIcon name="grid" />, permission: "jobs.view", badge: "failed_jobs" },
      { key: "/admin/health", label: "System health", icon: <NxIcon name="monitor" />, permission: "health.view" },
      { key: "/admin/api", label: "API clients", icon: <NxIcon name="code" />, permission: "api.manage" },
      { key: "/admin/integrations", label: "Integrations", icon: <NxIcon name="plug" />, permission: "integrations.manage" },
      { key: "/admin/flags", label: "Feature flags", icon: <NxIcon name="flask" />, permission: "flags.manage" },
      { key: "/admin/settings", label: "Settings", icon: <NxIcon name="gear" />, permission: "settings.manage" },
    ],
  },
  {
    key: "data",
    icon: "database",
    label: "Data",
    items: [
      // Here rather than under Administration, and the permission is why: what
      // the page shows is a count of rows the reader can already see, gated on
      // `records.view`, so it belongs beside the other things one does *to the
      // data* rather than in the group about running the platform. Putting it
      // there gave a viewer an "Administration" heading with one entry under
      // it (§65).
      //
      // The address stays `/admin/quality` — the tracker's, and the API's. A
      // path prefix is not a permission boundary here: `/admin/users` is
      // readable by every persona too.
      { key: "/admin/quality", label: "Data quality", icon: <NxIcon name="quality" />, permission: "records.view" },
      // `records.view` and not `tags.manage`: the page is worth opening to
      // find out what the tags *mean*, and it says which permission curating
      // them needs rather than hiding itself (§37, §76).
      { key: "/admin/tags", label: "Tags", icon: <NxIcon name="tag" />, permission: "records.view" },
      { key: "/import", label: "Import", icon: <NxIcon name="import" />, permission: "records.import", flag: "csv-import" },
      { key: "/exports", label: "Exports", icon: <NxIcon name="export" />, permission: "records.export" },
    ],
  },
  {
    key: "showcase",
    icon: "grid",
    label: "Template",
    items: [
      { key: "/showcase/components", label: "Components", icon: <NxIcon name="grid" /> },
      { key: "/showcase/templates", label: "Page gallery", icon: <NxIcon name="layout" /> },
    ],
  },
];

/** Flattened, for resolving the selected key and for the command palette. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/**
 * The item a path belongs to — the longest matching key.
 *
 * Longest wins so `/admin/users` selects Users rather than the Administration
 * overview it also starts with.
 */
export function selectedKeyFor(pathname: string): string {
  // `/` redirects to `/dashboard`, so it selects the same item.
  if (pathname === "/") return "/dashboard";
  let best: string | undefined;
  for (const item of NAV_ITEMS) {
    if (
      (pathname === item.key || pathname.startsWith(`${item.key}/`)) &&
      (!best || item.key.length > best.length)
    ) {
      best = item.key;
    }
  }
  // A page outside the menu (a profile, a setting, an error) selects nothing:
  // highlighting the dashboard there read as "you are still on the page you
  // came from".
  return best ?? "";
}

/** Breadcrumb trail for a path, from the navigation itself. */
/** Pages that live outside the navigation, and the trail each one reads as. */
const OUTSIDE_NAV: { prefix: string; trail: { label: string; key: string }[] }[] = [
  { prefix: "/profile/", trail: [{ label: "People", key: "/admin/users" }, { label: "Profile", key: "" }] },
  { prefix: "/profile", trail: [{ label: "Account", key: "/profile" }, { label: "Profile", key: "/profile" }] },
  { prefix: "/settings/preferences", trail: [{ label: "Account", key: "/profile" }, { label: "Preferences", key: "/settings/preferences" }] },
  { prefix: "/settings/security", trail: [{ label: "Account", key: "/profile" }, { label: "Security", key: "/settings/security" }] },
  { prefix: "/errors/", trail: [{ label: "Nucleus", key: "/home" }, { label: "Error", key: "" }] },
  { prefix: "/compare", trail: [{ label: "Records", key: "/projects" }, { label: "Compare", key: "/compare" }] },
];

export function trailFor(pathname: string): { label: string; key: string }[] {
  const outside = OUTSIDE_NAV.find((entry) => pathname === entry.prefix || pathname.startsWith(entry.prefix));
  if (outside) return outside.trail.map((crumb) => ({ ...crumb, key: crumb.key || pathname }));
  const selected = selectedKeyFor(pathname);
  for (const group of NAV_GROUPS) {
    const item = group.items.find((candidate) => candidate.key === selected);
    if (item) {
      return group.key === "overview" && item.key === "/dashboard"
        ? [{ label: item.label, key: item.key }]
        : [
            { label: group.label, key: group.items[0]?.key ?? item.key },
            { label: item.label, key: item.key },
          ];
    }
  }
  return [{ label: "Nucleus", key: "/" }];
}
