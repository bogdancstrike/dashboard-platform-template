import { Route } from "react-router-dom";

import { lazyPage } from "./lazyPage";
import { LandingRedirect } from "./RouteHelpers";

const HomePage = lazyPage(() => import("@/pages/HomePage"));
const AssistantPage = lazyPage(() => import("@/pages/AssistantPage"));
const InsightsPage = lazyPage(() => import("@/pages/InsightsPage"));
const DocumentsPage = lazyPage(() => import("@/pages/DocumentsPage"));
const DashboardPage = lazyPage(() => import("@/pages/DashboardPage"));
const ActivityPage = lazyPage(() => import("@/pages/ActivityPage"));
const AnalyticsPage = lazyPage(() => import("@/pages/AnalyticsPage"));
const ReportsPage = lazyPage(() => import("@/pages/ReportsPage"));
const NotificationsPage = lazyPage(() => import("@/pages/NotificationsPage"));
const AnnouncementsPage = lazyPage(() => import("@/pages/AnnouncementsPage"));

/** Overview and AI: where a reader lands, and the assistant (§40, §41, §43, §44). */
export const overviewRoutes = (
  <>
    {/* The reader's own home page (§40), not a constant. */}
    <Route index element={<LandingRedirect />} />
    <Route path="home" element={<HomePage />} />
    {/* AI (§41): the assistant, with the conversation open in the path. */}
    <Route path="assistant" element={<AssistantPage />} />
    <Route path="assistant/:conversationId" element={<AssistantPage />} />
    {/* AI (§43): insights — a question about the records, answered as a page. */}
    <Route path="ai/insights" element={<InsightsPage />} />
    {/* AI (§44): ask your documents, the collection and conversation in the query. */}
    <Route path="ai/documents" element={<DocumentsPage />} />
    <Route path="dashboard" element={<DashboardPage />} />
    <Route path="activity" element={<ActivityPage />} />
    <Route path="analytics" element={<AnalyticsPage />} />
    <Route path="reports" element={<ReportsPage />} />
    <Route path="notifications" element={<NotificationsPage />} />
    <Route path="announcements" element={<AnnouncementsPage />} />
  </>
);
