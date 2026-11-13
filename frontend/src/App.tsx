import { Skeleton } from "antd";
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { AppShell } from "@/app/AppShell";
import { AssistantLauncher } from "@/components/assistant/AssistantLauncher";
import { signInAgain } from "@/auth/keycloak";
import { ProblemPage, type ProblemKind } from "@/components/ProblemPage";
import { useAuth } from "@/auth/AuthProvider";
import { landingPath } from "@/pages/PreferencesPage";

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
const TimelinePage = lazy(() => import("@/pages/work/TimelinePage"));
const SprintsPage = lazy(() => import("@/pages/work/SprintsPage"));
const WorkflowsPage = lazy(() => import("@/pages/WorkflowsPage"));
const CalendarPage = lazy(() => import("@/pages/CalendarPage"));
const MailPage = lazy(() => import("@/pages/MailPage"));
// Time & decisions
const TimePage = lazy(() => import("@/pages/decisions/TimePage"));
const ApprovalsPage = lazy(() => import("@/pages/decisions/ApprovalsPage"));
const SlaPoliciesPage = lazy(() => import("@/pages/decisions/SlaPoliciesPage"));
const FormsPage = lazy(() => import("@/pages/decisions/FormsPage"));
const FormDesignerPage = lazy(() => import("@/pages/decisions/FormDesignerPage"));
const ChatPage = lazy(() => import("@/pages/ChatPage"));
const DocsPage = lazy(() => import("@/pages/DocsPage"));
const HomePage = lazy(() => import("@/pages/HomePage"));
const DocumentsPage = lazy(() => import("@/pages/DocumentsPage"));
const InsightsPage = lazy(() => import("@/pages/InsightsPage"));
const AssistantPage = lazy(() => import("@/pages/AssistantPage"));
const AdminHomePage = lazy(() => import("@/pages/admin/AdminHomePage"));
const SystemSettingsPage = lazy(() => import("@/pages/admin/SettingsPage"));
const FlagsPage = lazy(() => import("@/pages/admin/FlagsPage"));
const QualityPage = lazy(() => import("@/pages/admin/QualityPage"));
const TagsPage = lazy(() => import("@/pages/admin/TagsPage"));
const LogsPage = lazy(() => import("@/pages/admin/LogsPage"));
const JobsPage = lazy(() => import("@/pages/admin/JobsPage"));
const GroupsPage = lazy(() => import("@/pages/admin/GroupsPage"));
const OrganizationsPage = lazy(() => import("@/pages/admin/OrganizationsPage"));
const ApiClientsPage = lazy(() => import("@/pages/admin/ApiClientsPage"));
const IntegrationsPage = lazy(() => import("@/pages/admin/IntegrationsPage"));
const ExportsPage = lazy(() => import("@/pages/ExportsPage"));
const ImportPage = lazy(() => import("@/pages/ImportPage"));
const SecurityPage = lazy(() => import("@/pages/SecurityPage"));
const FavoritesPage = lazy(() => import("@/pages/FavoritesPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const ComparePage = lazy(() => import("@/pages/ComparePage"));
const ShowcaseComponentsPage = lazy(() => import("@/pages/showcase/ComponentsPage"));
const ShowcaseTemplatesPage = lazy(() => import("@/pages/showcase/TemplatesPage"));
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
// Records & analytics (§12, §13, §18, §22).
const CustomerHealthPage = lazy(() => import("@/pages/analytics/CustomerHealthPage"));
const ContractsPage = lazy(() => import("@/pages/analytics/ContractsPage"));
const ContractDetailPage = lazy(() => import("@/pages/analytics/ContractDetailPage"));
const RecordGridPage = lazy(() => import("@/pages/analytics/RecordGridPage"));
const AlertsPage = lazy(() => import("@/pages/analytics/AlertsPage"));
const WatchDetailPage = lazy(() => import("@/pages/analytics/WatchDetailPage"));

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
 * A problem page as a route (§34).
 *
 * Two of the six cannot be reached by asking for them — a session ends when it
 * ends, and the API is down when it is down — so without an address they would
 * be screens nobody could look at until the day they mattered, which is the
 * day nobody wants to find out the copy is wrong. They are also where the
 * application *sends* a reader: `keycloak.ts` goes to `/errors/session-expired`
 * rather than bouncing somebody through a sign-in that has already failed once.
 *
 * Written out one route per address rather than as `errors/:kind`, and that is
 * not verbosity for its own sake: a parameterised route is invisible to the
 * template gallery's completeness test (§61), which reads concrete paths — so
 * the six pages would exist and nothing would know they did.
 */
function ProblemRoute({ kind }: { kind: ProblemKind }) {
  return (
    <ProblemPage
      kind={kind}
      // Retrying an address that is *demonstrating* a failure is a reload,
      // which is honest and proves the button does something. The declaration
      // decides whether the button appears at all.
      onRetry={() => window.location.reload()}
      // Not a reload: a revoked session is keyed on the identity provider's
      // own session id, and a browser holding the SSO cookie reloads straight
      // back into the same one — so the only button on the page would do
      // nothing and the reader would be locked out of a platform they had just
      // authenticated to.
      onSignIn={() => void signInAgain()}
      missing={kind === "forbidden" ? ["records.view"] : []}
    />
  );
}

/** The address nobody meant to ask for. */
function NotFound() {
  return <ProblemPage kind="not_found" />;
}

/**
 * Where arriving with no address lands (§40).
 *
 * The preference is read rather than a route constant, and it waits for the
 * profile rather than guessing: redirecting to the dashboard and *then*
 * redirecting again once preferences load would put a page in the back button
 * that the reader never asked for.
 */
/**
 * `/search/saved/:searchId` — the address a bookmarked saved search carries.
 *
 * A redirect that keeps what it was given. The previous version sent every
 * such link to a bare `/explore`, discarding the id, so a bookmark to a saved
 * search opened the explorer with no search in it — which `/favorites` (§38)
 * made visible. `?saved=` is what the explorer loads a search from, so that is
 * what this hands it.
 */
function SavedSearchLink() {
  const { searchId } = useParams();
  return (
    <Navigate to={searchId ? `/explore?saved=${searchId}` : "/explore"} replace />
  );
}


function Home() {
  const { profile, loading } = useAuth();
  if (loading) return <Loading />;
  return <Navigate to={landingPath(profile?.preferences.defaults.landing_page)} replace />;
}

export default function App() {
  return (
    <>
    {/* The assistant's launcher (⌘J) floats over every page (§41). */}
    <AssistantLauncher />
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
        {/* AI (§41): the assistant, with the conversation open in the path. */}
        <Route
          path="assistant"
          element={
            <Suspense fallback={<Loading />}>
              <AssistantPage />
            </Suspense>
          }
        />
        <Route
          path="assistant/:conversationId"
          element={
            <Suspense fallback={<Loading />}>
              <AssistantPage />
            </Suspense>
          }
        />
        {/* AI (§43): insights — a question about the records, answered as a page. */}
        <Route
          path="ai/insights"
          element={
            <Suspense fallback={<Loading />}>
              <InsightsPage />
            </Suspense>
          }
        />
        {/* AI (§44): ask your documents, the collection and conversation in the query. */}
        <Route
          path="ai/documents"
          element={
            <Suspense fallback={<Loading />}>
              <DocumentsPage />
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
          path="chat"
          element={
            <Suspense fallback={<Loading />}>
              <ChatPage />
            </Suspense>
          }
        />
        <Route
          path="chat/:channelId"
          element={
            <Suspense fallback={<Loading />}>
              <ChatPage />
            </Suspense>
          }
        />
        <Route
          path="docs"
          element={
            <Suspense fallback={<Loading />}>
              <DocsPage />
            </Suspense>
          }
        />
        <Route
          path="docs/:pageId"
          element={
            <Suspense fallback={<Loading />}>
              <DocsPage />
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
          path="timeline"
          element={
            <Suspense fallback={<Loading />}>
              <TimelinePage />
            </Suspense>
          }
        />
        <Route
          path="sprints"
          element={
            <Suspense fallback={<Loading />}>
              <SprintsPage />
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

        {/* Records & analytics (§12, §13, §22): health, contracts, alerts. */}
        <Route path="customers/health" element={<Suspense fallback={<Loading />}><CustomerHealthPage /></Suspense>} />
        <Route path="contracts" element={<Suspense fallback={<Loading />}><ContractsPage /></Suspense>} />
        <Route path="contracts/:id" element={<Suspense fallback={<Loading />}><ContractDetailPage /></Suspense>} />
        <Route path="alerts" element={<Suspense fallback={<Loading />}><AlertsPage /></Suspense>} />
        <Route path="alerts/:id" element={<Suspense fallback={<Loading />}><WatchDetailPage /></Suspense>} />

        {/* Records — six datasets, six pages (§7, §8). The list layouts are
            deliberately unlike one another; what they share is the query
            contract underneath, not a template. */}
        <Route path="tasks">
          <Route path="grid" element={<Suspense fallback={<Loading />}><RecordGridPage resourceKey="task" /></Suspense>} />
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
            <Route path="grid" element={<Suspense fallback={<Loading />}><RecordGridPage resourceKey={entity.key} /></Suspense>} />
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
        {/* The id goes with it. This redirect used to drop it, so a bookmark
            to a saved search opened an empty explorer — the explorer now
            loads a search named in `?saved=`, which is what makes one
            linkable at all (§5, §38). */}
        <Route path="search/saved/:searchId" element={<SavedSearchLink />} />
        <Route
          path="favorites"
          element={
            <Suspense fallback={<Loading />}>
              <FavoritesPage />
            </Suspense>
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
          element={
            <Suspense fallback={<Loading />}>
              <GroupsPage />
            </Suspense>
          }
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
          element={
            <Suspense fallback={<Loading />}>
              <OrganizationsPage />
            </Suspense>
          }
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
            <Suspense fallback={<Loading />}>
              <ApiClientsPage />
            </Suspense>
          }
        />
        <Route
          path="admin/integrations"
          element={
            <Suspense fallback={<Loading />}>
              <IntegrationsPage />
            </Suspense>
          }
        />
        <Route
          path="admin/tags"
          element={
            <Suspense fallback={<Loading />}>
              <TagsPage />
            </Suspense>
          }
        />
        <Route
          path="admin/quality"
          element={
            <Suspense fallback={<Loading />}>
              <QualityPage />
            </Suspense>
          }
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

        {/* Time & decisions */}
        <Route
          path="time"
          element={
            <Suspense fallback={<Loading />}>
              <TimePage />
            </Suspense>
          }
        />
        <Route
          path="approvals"
          element={
            <Suspense fallback={<Loading />}>
              <ApprovalsPage />
            </Suspense>
          }
        />
        <Route
          path="admin/sla"
          element={
            <Suspense fallback={<Loading />}>
              <SlaPoliciesPage />
            </Suspense>
          }
        />
        <Route
          path="admin/forms"
          element={
            <Suspense fallback={<Loading />}>
              <FormsPage />
            </Suspense>
          }
        />
        <Route
          path="admin/forms/:id"
          element={
            <Suspense fallback={<Loading />}>
              <FormDesignerPage />
            </Suspense>
          }
        />

        {/* Data */}
        <Route
          path="import"
          element={
            <Suspense fallback={<Loading />}>
              <ImportPage />
            </Suspense>
          }
        />
        <Route
          path="exports"
          element={
            <Suspense fallback={<Loading />}>
              <ExportsPage />
            </Suspense>
          }
        />

        {/* Template showcase */}
        <Route
          path="showcase/components"
          element={
            <Suspense fallback={<Loading />}>
              <ShowcaseComponentsPage />
            </Suspense>
          }
        />
        <Route
          path="showcase/templates"
          element={
            <Suspense fallback={<Loading />}>
              <ShowcaseTemplatesPage />
            </Suspense>
          }
        />

        {/* Two or more records side by side (§47). One address rather than
            one per dataset: the dataset is a parameter of the question, and
            `/orders/compare` would be six routes for one page. */}
        <Route
          path="compare"
          element={
            <Suspense fallback={<Loading />}>
              <ComparePage />
            </Suspense>
          }
        />

        {/* Personal */}
        <Route
          path="profile"
          element={
            <Suspense fallback={<Loading />}>
              <ProfilePage />
            </Suspense>
          }
        />
        {/* A colleague's, showing only what this reader may be told (§40). */}
        <Route
          path="profile/:userId"
          element={
            <Suspense fallback={<Loading />}>
              <ProfilePage />
            </Suspense>
          }
        />
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
          element={
            <Suspense fallback={<Loading />}>
              <SecurityPage />
            </Suspense>
          }
        />

        <Route path="system" element={<Navigate to="/admin/health" replace />} />
        {/* One per address, so the gallery's completeness test can see them. */}
        <Route path="errors/401" element={<ProblemRoute kind="unauthorized" />} />
        <Route path="errors/403" element={<ProblemRoute kind="forbidden" />} />
        <Route path="errors/404" element={<ProblemRoute kind="not_found" />} />
        <Route path="errors/500" element={<ProblemRoute kind="server" />} />
        <Route path="errors/maintenance" element={<ProblemRoute kind="maintenance" />} />
        <Route
          path="errors/session-expired"
          element={<ProblemRoute kind="session_expired" />}
        />
        <Route path="errors/switched-off" element={<ProblemRoute kind="switched_off" />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </>
  );
}
