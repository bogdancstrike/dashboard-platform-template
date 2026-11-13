import { CoIcon } from "@/components/icons/CoIcon";
import { NxIcon } from "@/components/NxIcon";
import { TdIcon } from "@/components/icons/TdIcon";
import { PlanIcon } from "@/components/icons/PlanIcon";
import { AstIcon } from "@/components/icons/AstIcon";
import { KnIcon } from "@/components/icons/KnIcon";

import type { NavGroup } from "./types";

/** The menu, in order: each group and the pages under it (§1). */
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
      { key: "/onboarding", label: "Getting started", icon: <NxIcon name="check" /> },
      { key: "/dashboard", label: "Dashboard", icon: <NxIcon name="gauge" /> },
      { key: "/dashboards", label: "My dashboards", icon: <NxIcon name="layout" />, permission: "dashboards.manage", flag: "dashboard-builder" },
      { key: "/activity", label: "Activity", icon: <NxIcon name="activity" /> },
      { key: "/notifications", label: "Notifications", icon: <NxIcon name="bell" />, badge: "unread" },
      // Everything waiting on a decision — timesheets, access, held edits, reports.
      { key: "/approvals", label: "Approvals", icon: <TdIcon name="stamp" />, badge: "pending_approvals" },
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
      { key: "/alerts", label: "Alerts", icon: <NxIcon name="activity" />, permission: "records.view" },
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
      { key: "/time", label: "Time & timesheets", icon: <TdIcon name="clock" />, permission: "time.track" },
      { key: "/chat", label: "Chat", icon: <CoIcon name="chat" />, permission: "chat.use", badge: "chat_unread" },
      { key: "/docs", label: "Docs", icon: <CoIcon name="docs" />, permission: "docs.view" },
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
      { key: "/contracts", label: "Contracts", icon: <NxIcon name="report" />, permission: "records.view" },
      { key: "/customers/health", label: "Customer health", icon: <NxIcon name="heart" />, permission: "records.view" },
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
      { key: "/admin/sla", label: "SLA policies", icon: <TdIcon name="hourglass" />, permission: "sla.manage" },
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
      // Intake forms create records, so they sit with the other ways data arrives.
      { key: "/admin/forms", label: "Forms", icon: <TdIcon name="form" />, permission: "records.view" },
    ],
  },
  {
    // The developer portal (§31): the API reference read from the platform,
    // a try-it console and usage per API client. The UI component docs stay
    // under Template and are linked from the portal rather than copied.
    key: "developers",
    icon: "code",
    label: "Developers",
    items: [
      { key: "/developers", label: "API reference", icon: <NxIcon name="code" /> },
      { key: "/developers/console", label: "Try it", icon: <NxIcon name="plug" /> },
      { key: "/developers/usage", label: "API usage", icon: <NxIcon name="area" />, permission: "api.manage" },
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
