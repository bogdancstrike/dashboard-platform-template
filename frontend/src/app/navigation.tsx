import type { ReactNode } from "react";
import {
  ApartmentOutlined,
  ApiOutlined,
  AreaChartOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  BlockOutlined,
  BellOutlined,
  BranchesOutlined,
  BugOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  ClusterOutlined,
  ContainerOutlined,
  ControlOutlined,
  DashboardOutlined,
  HomeOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FundProjectionScreenOutlined,
  HeartOutlined,
  ImportOutlined,
  LayoutOutlined,
  MailOutlined,
  MonitorOutlined,
  NodeIndexOutlined,
  NotificationOutlined,
  ProjectOutlined,
  SafetyCertificateOutlined,
  TagsOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  GlobalOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";

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
 */
export interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  /** Permission required to see it at all. Absent means everyone. */
  permission?: string;
  /** Which counter from the badge poll rides along. */
  badge?: string;
  /** Marks a feature still behind a flag (§1, §27). */
  experimental?: boolean;
  disabled?: boolean;
}

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "overview",
    label: "Overview",
    items: [
      // First, and above the dashboard, because it is where arriving with no
      // preference lands: a navigation whose first item is not the default
      // landing page is a navigation that disagrees with the logo.
      { key: "/home", label: "Home", icon: <HomeOutlined /> },
      { key: "/dashboard", label: "Dashboard", icon: <DashboardOutlined /> },
      { key: "/dashboards", label: "My dashboards", icon: <LayoutOutlined />, permission: "dashboards.manage" },
      { key: "/activity", label: "Activity", icon: <BranchesOutlined /> },
      { key: "/notifications", label: "Notifications", icon: <BellOutlined />, badge: "unread" },
      { key: "/announcements", label: "Announcements", icon: <NotificationOutlined /> },
    ],
  },
  {
    key: "analyse",
    label: "Analyse",
    items: [
      { key: "/analytics", label: "Analytics", icon: <AreaChartOutlined />, permission: "records.view" },
      { key: "/reports", label: "Reports", icon: <BarChartOutlined />, permission: "reports.view" },
      { key: "/reports/builder", label: "Report builder", icon: <ProjectOutlined />, permission: "reports.manage" },
      { key: "/charts/builder", label: "Chart builder", icon: <AreaChartOutlined />, permission: "reports.manage" },
      { key: "/maps", label: "Maps", icon: <GlobalOutlined /> },
    ],
  },
  {
    key: "work",
    label: "Work",
    items: [
      { key: "/tasks", label: "Tasks", icon: <CheckSquareOutlined />, permission: "tasks.view", badge: "my_tasks" },
      { key: "/kanban", label: "Kanban boards", icon: <ProjectOutlined />, permission: "tasks.view" },
            // `automations.manage` and not `tasks.manage`: a rule's condition quotes
      // the fields and values of records its reader may have no other way to
      // see, so reading the list is privileged — and an operator who triages
      // tasks is not somebody who may make the platform email forty people.
      {
        key: "/workflows",
        label: "Workflows",
        icon: <NodeIndexOutlined />,
        permission: "automations.manage",
      },
      { key: "/calendar", label: "Calendar", icon: <CalendarOutlined />, permission: "calendar.view" },
      { key: "/mail", label: "Mail", icon: <MailOutlined />, permission: "mail.access", badge: "unread_mail" },
      { key: "/files", label: "Files", icon: <FolderOpenOutlined />, permission: "files.view" },
    ],
  },
  {
    key: "records",
    label: "Records",
    items: [
      { key: "/projects", label: "Projects", icon: <FundProjectionScreenOutlined />, permission: "records.view" },
      { key: "/customers", label: "Customers", icon: <ShopOutlined />, permission: "records.view" },
      { key: "/orders", label: "Orders", icon: <ShoppingCartOutlined />, permission: "records.view" },
      { key: "/tickets", label: "Tickets", icon: <BugOutlined />, permission: "records.view", badge: "open_tickets" },
      { key: "/devices", label: "Devices", icon: <DeploymentUnitOutlined />, permission: "records.view" },
    ],
  },
  {
    key: "find",
    label: "Find",
    items: [
      // Saved searches are a *module of* the Data Explorer, not a page of their
      // own — you open one from the explorer and it loads there, the way
      // gif_responder's SavedSearchControls works. A separate destination would
      // mean two places that both claim to be where searches live.
      { key: "/explore", label: "Data Explorer", icon: <SearchOutlined />, permission: "records.view" },
      { key: "/find/global", label: "Global search", icon: <GlobalOutlined />, permission: "records.view" },
      { key: "/find/relationships", label: "Relationships", icon: <BranchesOutlined />, permission: "records.view" },
      { key: "/find/catalog", label: "Data catalog", icon: <DatabaseOutlined />, permission: "records.view" },
      { key: "/favorites", label: "Favorites", icon: <HeartOutlined /> },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    items: [
      { key: "/admin", label: "Overview", icon: <ControlOutlined />, permission: "admin.access" },
      { key: "/admin/users", label: "Users", icon: <UserOutlined />, permission: "users.view" },
      { key: "/admin/groups", label: "Groups", icon: <TeamOutlined />, permission: "users.view" },
      { key: "/admin/roles", label: "Roles & permissions", icon: <SafetyCertificateOutlined />, permission: "roles.manage" },
      // `users.view` and not `orgs.manage`: reading where people sit is
      // directory information, and this permission is what gates the *route*
      // as well as the menu entry — declaring the write permission here would
      // make the page's own read-only state unreachable. The commercial
      // fields are withheld by the service instead.
      { key: "/admin/organizations", label: "Organizations", icon: <ApartmentOutlined />, permission: "users.view" },
      { key: "/admin/audit", label: "Audit log", icon: <AuditOutlined />, permission: "audit.view" },
      { key: "/admin/logs", label: "System logs", icon: <FileTextOutlined />, permission: "logs.view" },
      { key: "/admin/jobs", label: "Background jobs", icon: <ClusterOutlined />, permission: "jobs.view", badge: "failed_jobs" },
      { key: "/admin/health", label: "System health", icon: <MonitorOutlined />, permission: "health.view" },
      { key: "/admin/api", label: "API clients", icon: <ApiOutlined />, permission: "api.manage" },
      { key: "/admin/integrations", label: "Integrations", icon: <BlockOutlined />, permission: "integrations.manage" },
      { key: "/admin/flags", label: "Feature flags", icon: <ExperimentOutlined />, permission: "flags.manage" },
      { key: "/admin/settings", label: "Settings", icon: <SettingOutlined />, permission: "settings.manage" },
    ],
  },
  {
    key: "data",
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
      { key: "/admin/quality", label: "Data quality", icon: <FundProjectionScreenOutlined />, permission: "records.view" },
      // `records.view` and not `tags.manage`: the page is worth opening to
      // find out what the tags *mean*, and it says which permission curating
      // them needs rather than hiding itself (§37, §76).
      { key: "/admin/tags", label: "Tags", icon: <TagsOutlined />, permission: "records.view" },
      { key: "/import", label: "Import", icon: <ImportOutlined />, permission: "records.import" },
      { key: "/exports", label: "Exports", icon: <ContainerOutlined />, permission: "records.export" },
    ],
  },
  {
    key: "showcase",
    label: "Template",
    items: [
      { key: "/showcase/components", label: "Components", icon: <AppstoreOutlined /> },
      { key: "/showcase/templates", label: "Page gallery", icon: <DatabaseOutlined /> },
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
  return best ?? "/dashboard";
}

/** Breadcrumb trail for a path, from the navigation itself. */
export function trailFor(pathname: string): { label: string; key: string }[] {
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
