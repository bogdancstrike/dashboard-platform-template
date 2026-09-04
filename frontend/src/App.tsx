import { Skeleton } from "antd";
import { Button, Result } from "antd";
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { AppShell } from "@/app/AppShell";
import { PlaceholderPage } from "@/pages/PlaceholderPage";

/**
 * Chart-heavy pages load on demand.
 *
 * ECharts is most of the bundle, and somebody who opens the audit log should
 * not download a charting library to read it. Splitting at the route is the
 * safe way to do this: the boundary follows an `import()` the bundler can see,
 * rather than a hand-drawn partition of somebody else's dependency graph —
 * which is what produced a cross-chunk cycle and a blank page last time.
 */
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const DataExplorerPage = lazy(() => import("@/pages/DataExplorerPage"));
const GlobalSearchPage = lazy(() => import("@/pages/GlobalSearchPage"));
const DataCatalogPage = lazy(() => import("@/pages/DataCatalogPage"));
const RelationshipExplorerPage = lazy(() => import("@/pages/RelationshipExplorerPage"));
const AuditExplorerPage = lazy(() => import("@/pages/AuditExplorerPage"));
const EntityListPage = lazy(() => import("@/pages/EntityListPage"));
const EntityDetailPage = lazy(() => import("@/pages/EntityDetailPage"));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage"));
const SystemPage = lazy(() => import("@/pages/SystemPage"));

function Loading() {
  return <Skeleton active paragraph={{ rows: 8 }} />;
}

/**
 * Every route the shell navigates to resolves to something.
 *
 * The unbuilt ones render an honest placeholder naming the spec section and
 * what will be there, rather than a blank page or a 404. That is what lets the
 * navigation be complete from the first commit — a shell whose menu is mostly
 * dead ends cannot be reviewed, and neither can a menu that only lists the
 * three screens that happen to exist.
 */
function NotFound() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="404"
      subTitle="No page answers to that address."
      extra={
        <Button type="primary" onClick={() => navigate("/")}>
          Back to the dashboard
        </Button>
      }
    />
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route
          path="dashboard"
          element={
            <Suspense fallback={<Loading />}>
              <DashboardPage />
            </Suspense>
          }
        />

        {/* Overview */}
        <Route
          path="activity"
          element={
            <PlaceholderPage
              section="§35, §48"
              summary="Everything that happened, filterable by activity type."
              bullets={[
                "One feed across users, records, comments, uploads and system events",
                "Filter by activity type, actor, resource and date range",
                "The same timeline component that renders on every detail page",
              ]}
            />
          }
        />
        <Route
          path="analytics"
          element={
            <PlaceholderPage
              section="§2, §44, §53"
              summary="Explore operational performance across records, teams and time periods."
              bullets={[
                "Cross-entity KPIs and trends with a shared period and filter context",
                "Slice, compare and drill from a chart into the records behind it",
                "Save an analysis as a report, chart or dashboard widget",
              ]}
            />
          }
        />
        <Route
          path="reports"
          element={
            <PlaceholderPage
              section="§28"
              summary="Build a report from dimensions, metrics, filters and a visualisation."
              bullets={[
                "Pick dimensions, metrics, grouping, sorting and a time period",
                "Save it, share it, schedule it",
                "Export the result, respecting the current filters (§30)",
              ]}
            />
          }
        />

        {/* Work */}
        <Route
          path="calendar"
          element={
            <PlaceholderPage
              section="§19"
              summary="Month, week, day and agenda views over the same events."
              bullets={["Drag and resize events", "Recurring series", "Participants and responses"]}
            />
          }
        />
        <Route
          path="mail"
          element={
            <PlaceholderPage
              section="§14–§16"
              summary="A threaded mailbox: inbox, detail and composer."
              bullets={[
                "Folders, labels, starring and bulk actions",
                "Threaded conversation view (§63 split view)",
                "Composer with attachments, templates and scheduled send",
              ]}
            />
          }
        />
        <Route
          path="files"
          element={
            <PlaceholderPage
              section="§20"
              summary="Folders, files, previews and uploads."
              bullets={["Nested folders with a materialised path", "Grid and list views", "Drag-and-drop upload with progress"]}
            />
          }
        />


        {/* Analyse */}
        <Route
          path="dashboards"
          element={
            <PlaceholderPage
              section="§45, §67"
              summary="Your dashboards — build them from widgets, and share them the way saved searches are shared."
              bullets={[
                "Add, remove, resize, reorder and configure widgets on a 12-column grid",
                "KPI, chart, table, activity, alerts, tasks and recent-items widgets",
                "Private by default · shared with named members · public — only the owner edits",
                "One of them is your home page (§67)",
              ]}
            />
          }
        />
        <Route
          path="reports/builder"
          element={
            <PlaceholderPage
              section="§28"
              summary="Compose a report from dimensions, metrics, filters, grouping and a period."
              bullets={[
                "Pick the entity, then the dimensions and metrics it offers",
                "Preview the result as you build it, server-side (§71)",
                "Save, share, schedule and export",
              ]}
            />
          }
        />
        <Route
          path="charts/builder"
          element={
            <PlaceholderPage
              section="§28, §44"
              summary="Build a chart visually and drop it onto a dashboard."
              bullets={[
                "Every ECharts type the platform themes: line, area, stacked area, bar, stacked and horizontal bars, pie, donut, scatter, heatmap, funnel, gauge, timeline",
                "Live preview against real data, in both themes",
                "Save it as a widget, or export the underlying rows",
              ]}
            />
          }
        />
        <Route
          path="maps"
          element={
            <PlaceholderPage
              section="§44, §61"
              summary="Records on a map — customers, devices, orders and regions."
              bullets={[
                "Cluster markers by region, and drill into the filtered list (§44)",
                "Choropleth by region for revenue, tickets and device health",
                "The same period and filter controls the dashboard uses",
              ]}
            />
          }
        />
        <Route
          path="announcements"
          element={
            <PlaceholderPage
              section="§17, §34"
              summary="System messages and announcements, from the platform to everyone."
              bullets={[
                "Scheduled banners for maintenance windows and releases",
                "Targeted by role, organization or user",
                "Acknowledged per reader, so a notice can require a response",
              ]}
            />
          }
        />
        <Route
          path="kanban"
          element={
            <PlaceholderPage
              section="§18"
              summary="Boards, lanes and cards — with checklists, comments and drag."
              bullets={[
                "Drag a card between lanes and within a lane; the position survives a reload",
                "A card carries a to-do checklist, comments, attachments and an activity timeline",
                "Filter by assignee, label, due date and text, server-side",
              ]}
            />
          }
        />
        <Route
          path="workflows"
          element={
            <PlaceholderPage
              section="§49"
              summary="Condition → action automation, on the same query tree the search builder produces."
              bullets={[
                "When these conditions match, notify, email, raise a task or call a webhook",
                "Schedule and cooldown, so one breach does not send forty messages",
                "Dry-run against current data before enabling",
              ]}
            />
          }
        />
        <Route
          path="notifications"
          element={
            <Suspense fallback={<Loading />}>
              <NotificationsPage />
            </Suspense>
          }
        />

        {/* Records — one generic list and one generic detail, driven by the
            same declarations the explorer and the query builder read (§7, §8).
            `/tasks` is here too: the kanban board (§18) will become another
            view of the same records rather than another copy of them. */}
        {[
          { path: "tasks", key: "task" },
          { path: "projects", key: "project" },
          { path: "customers", key: "customer" },
          { path: "orders", key: "order" },
          { path: "tickets", key: "ticket" },
          { path: "devices", key: "device" },
        ].map((entity) => (
          <Route key={entity.path} path={entity.path}>
            <Route
              index
              element={
                <Suspense fallback={<Loading />}>
                  <EntityListPage resourceKey={entity.key} />
                </Suspense>
              }
            />
            <Route
              path=":id"
              element={
                <Suspense fallback={<Loading />}>
                  <EntityDetailPage resourceKey={entity.key} />
                </Suspense>
              }
            />
          </Route>
        ))}

        {/* Find */}
        <Route
          path="explore"
          element={
            <Suspense fallback={<Loading />}>
              <DataExplorerPage />
            </Suspense>
          }
        />
        <Route
          path="find/global"
          element={
            <Suspense fallback={<Loading />}>
              <GlobalSearchPage />
            </Suspense>
          }
        />
        <Route
          path="find/relationships"
          element={
            <Suspense fallback={<Loading />}>
              <RelationshipExplorerPage />
            </Suspense>
          }
        />
        <Route
          path="find/catalog"
          element={
            <Suspense fallback={<Loading />}>
              <DataCatalogPage />
            </Suspense>
          }
        />
        {/* Advanced and saved searches now live in Data Explorer. Preserve the
            original addresses because search URLs are routinely bookmarked. */}
        <Route path="search" element={<Navigate to="/explore" replace />} />
        <Route path="search/saved" element={<Navigate to="/explore?panel=saved" replace />} />
        <Route path="search/saved/:searchId" element={<Navigate to="/explore" replace />} />
        <Route
          path="favorites"
          element={
            <PlaceholderPage section="§38" summary="Everything you have bookmarked, in one place." />
          }
        />

        {/* Administration */}
        <Route
          path="admin"
          element={
            <PlaceholderPage
              section="§11"
              summary="The administration area — users, roles, settings and operations."
            />
          }
        />
        <Route
          path="admin/users"
          element={
            <PlaceholderPage
              section="§12"
              summary="Users: create, edit, suspend, assign roles, revoke sessions, impersonate."
            />
          }
        />
        <Route
          path="admin/groups"
          element={<PlaceholderPage section="§11" summary="Groups, and the permissions they add on top of a role." />}
        />
        <Route
          path="admin/roles"
          element={
            <PlaceholderPage
              section="§13"
              summary="The permission matrix, generated from the catalogue the API publishes."
              bullets={[
                "Every permission in code appears on the screen that grants it",
                "Editing a role changes behaviour on the next request, without a re-login",
              ]}
            />
          }
        />
        <Route
          path="admin/organizations"
          element={<PlaceholderPage section="§42" summary="Organizations, departments, teams and regions." />}
        />
        <Route
          path="admin/audit"
          element={
            <Suspense fallback={<Loading />}>
              <AuditExplorerPage />
            </Suspense>
          }
        />
        <Route
          path="admin/logs"
          element={
            <PlaceholderPage
              section="§22"
              summary="Application logs, with live tail and a detail pane."
              bullets={["Filter by level, service and date", "Pause and resume the stream", "Expand a line for its context and stack trace"]}
            />
          }
        />
        <Route
          path="admin/jobs"
          element={
            <PlaceholderPage
              section="§23"
              summary="Background jobs: progress, retries, logs and outcomes."
            />
          }
        />
        <Route
          path="admin/health"
          element={
            <Suspense fallback={<Loading />}>
              <SystemPage />
            </Suspense>
          }
        />
        <Route
          path="admin/api"
          element={
            <PlaceholderPage
              section="§25"
              summary="API clients, credentials, scopes, rate limits and usage."
              bullets={["A secret is shown once, at creation, and never again (§76)"]}
            />
          }
        />
        <Route
          path="admin/integrations"
          element={<PlaceholderPage section="§26" summary="Connected systems: status, configuration and test connection." />}
        />
        <Route
          path="admin/flags"
          element={<PlaceholderPage section="§27" summary="Feature flags with percentage and targeted rollout." />}
        />
        <Route
          path="admin/settings"
          element={<PlaceholderPage section="§11" summary="Runtime configuration, one row per setting." />}
        />

        {/* Data */}
        <Route
          path="import"
          element={
            <PlaceholderPage
              section="§29"
              summary="The import wizard: upload, map columns, validate, preview, execute."
            />
          }
        />
        <Route
          path="exports"
          element={<PlaceholderPage section="§30" summary="Exports, and the jobs that produce the large ones." />}
        />

        {/* Template showcase */}
        <Route
          path="showcase/components"
          element={<PlaceholderPage section="§60" summary="Every reusable component, in one place." />}
        />
        <Route
          path="showcase/templates"
          element={<PlaceholderPage section="§61" summary="Every page layout the template offers." />}
        />

        {/* Personal */}
        <Route
          path="settings/preferences"
          element={<PlaceholderPage section="§40" summary="Appearance, formats, defaults and notification preferences." />}
        />
        <Route
          path="settings/security"
          element={<PlaceholderPage section="§41" summary="Sessions, devices, sign-in history and security events." />}
        />

        <Route path="system" element={<Navigate to="/admin/health" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
