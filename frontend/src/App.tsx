import { Skeleton } from "antd";
import { Button, Result } from "antd";
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { AppShell } from "@/app/AppShell";
import { useAuth } from "@/auth/AuthProvider";
import { landingPath } from "@/pages/PreferencesPage";
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
const ActivityPage = lazy(() => import("@/pages/ActivityPage"));
const AnnouncementsPage = lazy(() => import("@/pages/AnnouncementsPage"));
const KanbanPage = lazy(() => import("@/pages/KanbanPage"));
const WorkflowsPage = lazy(() => import("@/pages/WorkflowsPage"));
const CalendarPage = lazy(() => import("@/pages/CalendarPage"));
const MailPage = lazy(() => import("@/pages/MailPage"));
const HomePage = lazy(() => import("@/pages/HomePage"));
const AdminHomePage = lazy(() => import("@/pages/admin/AdminHomePage"));
const SystemSettingsPage = lazy(() => import("@/pages/admin/SettingsPage"));
const FlagsPage = lazy(() => import("@/pages/admin/FlagsPage"));
const LogsPage = lazy(() => import("@/pages/admin/LogsPage"));
const JobsPage = lazy(() => import("@/pages/admin/JobsPage"));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const ReportBuilderPage = lazy(() => import("@/pages/ReportBuilderPage"));
const ChartBuilderPage = lazy(() => import("@/pages/ChartBuilderPage"));
const MapsPage = lazy(() => import("@/pages/MapsPage"));
const DashboardsPage = lazy(() => import("@/pages/DashboardsPage"));
const FilesPage = lazy(() => import("@/pages/FilesPage"));
const DataExplorerPage = lazy(() => import("@/pages/DataExplorerPage"));
const GlobalSearchPage = lazy(() => import("@/pages/GlobalSearchPage"));
const DataCatalogPage = lazy(() => import("@/pages/DataCatalogPage"));
const RelationshipExplorerPage = lazy(() => import("@/pages/RelationshipExplorerPage"));
const AuditExplorerPage = lazy(() => import("@/pages/AuditExplorerPage"));
const RolesPage = lazy(() => import("@/pages/RolesPage"));
const UsersPage = lazy(() => import("@/pages/UsersPage"));
const UserDetailPage = lazy(() => import("@/pages/UserDetailPage"));
const EntityDetailPage = lazy(() => import("@/pages/EntityDetailPage"));

/**
 * Six datasets, six pages (§7).
 *
 * There used to be one generic list here, driven by the resource declarations.
 * It was correct and it was unusable as a template: every entity looked like
 * every other entity, which taught a reader nothing about how to build the
 * seventh. These share their data layer — `useEntityView`, the same query, the
 * same URL keys — and share no layout at all, because a board, a portfolio
 * timeline, an account book, a ledger, a triage queue and a fleet monitor are
 * six different jobs.
 */
const TasksBoardPage = lazy(() => import("@/pages/entities/TasksBoardPage"));
// Tasks get their own detail page: it is the record people work *in*, and a
// generic field list is the wrong shape for that job (§8, §18, §36).
const TaskDetailPage = lazy(() => import("@/pages/entities/TaskDetailPage"));
const ProjectDeliveryPage = lazy(() => import("@/pages/entities/ProjectDeliveryPage"));
const TicketConsolePage = lazy(() => import("@/pages/entities/TicketConsolePage"));
const ProjectsPortfolioPage = lazy(() => import("@/pages/entities/ProjectsPortfolioPage"));
const CustomersPage = lazy(() => import("@/pages/entities/CustomersPage"));
const OrdersLedgerPage = lazy(() => import("@/pages/entities/OrdersLedgerPage"));
const TicketsQueuePage = lazy(() => import("@/pages/entities/TicketsQueuePage"));
const DevicesFleetPage = lazy(() => import("@/pages/entities/DevicesFleetPage"));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage"));
const SystemPage = lazy(() => import("@/pages/SystemPage"));
const PreferencesPage = lazy(() => import("@/pages/PreferencesPage"));

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

/**
 * Where arriving with no address lands (§40).
 *
 * The preference is read rather than a route constant, and it waits for the
 * profile rather than guessing: redirecting to the dashboard and *then*
 * redirecting again once preferences load would put a page in the back button
 * that the reader never asked for.
 */
function Home() {
  const { profile, loading } = useAuth();
  if (loading) return <Loading />;
  return <Navigate to={landingPath(profile?.preferences.defaults.landing_page)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {/* The reader's own home page (§40), not a constant. Somebody who
            works in the queue all day should not be shown a dashboard every
            morning on the way to it. */}
        <Route index element={<Home />} />
        <Route
          path="home"
          element={
            <Suspense fallback={<Loading />}>
              <HomePage />
            </Suspense>
          }
        />
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
            <Suspense fallback={<Loading />}>
              <ActivityPage />
            </Suspense>
          }
        />
        <Route
          path="analytics"
          element={
            <Suspense fallback={<Loading />}>
              <AnalyticsPage />
            </Suspense>
          }
        />
        <Route
          path="reports"
          element={
            <Suspense fallback={<Loading />}>
              <ReportsPage />
            </Suspense>
          }
        />

        {/* Work */}
        <Route
          path="calendar"
          element={
            <Suspense fallback={<Loading />}>
              <CalendarPage />
            </Suspense>
          }
        />
        <Route
          path="mail"
          element={
            <Suspense fallback={<Loading />}>
              <MailPage />
            </Suspense>
          }
        />
        <Route
          path="files"
          element={
            <Suspense fallback={<Loading />}>
              <FilesPage />
            </Suspense>
          }
        />
        <Route
          path="dashboards"
          element={
            <Suspense fallback={<Loading />}>
              <DashboardsPage />
            </Suspense>
          }
        />
        <Route
          path="reports/builder"
          element={
            <Suspense fallback={<Loading />}>
              <ReportBuilderPage />
            </Suspense>
          }
        />
        <Route
          path="charts/builder"
          element={
            <Suspense fallback={<Loading />}>
              <ChartBuilderPage />
            </Suspense>
          }
        />
        <Route
          path="maps"
          element={
            <Suspense fallback={<Loading />}>
              <MapsPage />
            </Suspense>
          }
        />
        <Route
          path="announcements"
          element={
            <Suspense fallback={<Loading />}>
              <AnnouncementsPage />
            </Suspense>
          }
        />
        <Route
          path="kanban"
          element={
            <Suspense fallback={<Loading />}>
              <KanbanPage />
            </Suspense>
          }
        />
        <Route
          path="workflows"
          element={
            <Suspense fallback={<Loading />}>
              <WorkflowsPage />
            </Suspense>
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

        {/* Records — six datasets, six pages (§7, §8). The list layouts are
            deliberately unlike one another; what they share is the query
            contract underneath, not a template. */}
        <Route path="tasks">
          <Route
            index
            element={
              <Suspense fallback={<Loading />}>
                <TasksBoardPage />
              </Suspense>
            }
          />
          <Route
            path=":id"
            element={
              <Suspense fallback={<Loading />}>
                <TaskDetailPage />
              </Suspense>
            }
          />
        </Route>

        {/* Where the record itself has a shape — a delivery review, a support
            console — the detail is its own page; the rest read the generic
            one, which renders whatever the declaration publishes (§8). */}
        {[
          { path: "projects", key: "project", list: <ProjectsPortfolioPage />, detail: <ProjectDeliveryPage /> },
          { path: "tickets", key: "ticket", list: <TicketsQueuePage />, detail: <TicketConsolePage /> },
          { path: "customers", key: "customer", list: <CustomersPage /> },
          { path: "orders", key: "order", list: <OrdersLedgerPage /> },
          { path: "devices", key: "device", list: <DevicesFleetPage /> },
        ].map((entity) => (
          <Route key={entity.path} path={entity.path}>
            <Route index element={<Suspense fallback={<Loading />}>{entity.list}</Suspense>} />
            <Route
              path=":id"
              element={
                <Suspense fallback={<Loading />}>
                  {entity.detail ?? <EntityDetailPage resourceKey={entity.key} />}
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
            <Suspense fallback={<Loading />}>
              <AdminHomePage />
            </Suspense>
          }
        />
        <Route path="admin/users">
          <Route
            index
            element={
              <Suspense fallback={<Loading />}>
                <UsersPage />
              </Suspense>
            }
          />
          <Route
            path=":id"
            element={
              <Suspense fallback={<Loading />}>
                <UserDetailPage />
              </Suspense>
            }
          />
        </Route>
        <Route
          path="admin/groups"
          element={<PlaceholderPage section="§11" summary="Groups, and the permissions they add on top of a role." />}
        />
        <Route
          path="admin/roles"
          element={
            <Suspense fallback={<Loading />}>
              <RolesPage />
            </Suspense>
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
            <Suspense fallback={<Loading />}>
              <LogsPage />
            </Suspense>
          }
        />
        <Route
          path="admin/jobs"
          element={
            <Suspense fallback={<Loading />}>
              <JobsPage />
            </Suspense>
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
          element={
            <Suspense fallback={<Loading />}>
              <FlagsPage />
            </Suspense>
          }
        />
        <Route
          path="admin/settings"
          element={
            <Suspense fallback={<Loading />}>
              <SystemSettingsPage />
            </Suspense>
          }
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
          element={
            <Suspense fallback={<Loading />}>
              <PreferencesPage />
            </Suspense>
          }
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
