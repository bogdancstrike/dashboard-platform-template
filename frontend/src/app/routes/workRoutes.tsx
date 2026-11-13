import { Route } from "react-router-dom";

import { lazyPage } from "./lazyPage";

const CalendarPage = lazyPage(() => import("@/pages/CalendarPage"));
const MailPage = lazyPage(() => import("@/pages/MailPage"));
const FilesPage = lazyPage(() => import("@/pages/FilesPage"));
const ChatPage = lazyPage(() => import("@/pages/ChatPage"));
const DocsPage = lazyPage(() => import("@/pages/DocsPage"));
const KanbanPage = lazyPage(() => import("@/pages/KanbanPage"));
const TimelinePage = lazyPage(() => import("@/pages/work/TimelinePage"));
const SprintsPage = lazyPage(() => import("@/pages/work/SprintsPage"));
const WorkflowsPage = lazyPage(() => import("@/pages/WorkflowsPage"));
const WorkflowCanvasPage = lazyPage(() => import("@/pages/WorkflowCanvasPage"));
const DevelopersPage = lazyPage(() => import("@/pages/DevelopersPage"));
const OnboardingPage = lazyPage(() => import("@/pages/OnboardingPage"));
// Time & decisions
const TimePage = lazyPage(() => import("@/pages/decisions/TimePage"));
const ApprovalsPage = lazyPage(() => import("@/pages/decisions/ApprovalsPage"));

/** Work: the tools people spend the day in, plus time and approvals. */
export const workRoutes = (
  <>
    <Route path="calendar" element={<CalendarPage />} />
    <Route path="mail" element={<MailPage />} />
    <Route path="files" element={<FilesPage />} />
    <Route path="chat" element={<ChatPage />} />
    <Route path="chat/:channelId" element={<ChatPage />} />
    <Route path="docs" element={<DocsPage />} />
    <Route path="docs/:pageId" element={<DocsPage />} />
    <Route path="kanban" element={<KanbanPage />} />
    <Route path="timeline" element={<TimelinePage />} />
    <Route path="sprints" element={<SprintsPage />} />
    <Route path="workflows" element={<WorkflowsPage />} />
    <Route path="workflows/:ruleId/canvas" element={<WorkflowCanvasPage />} />
    <Route path="developers" element={<DevelopersPage />} />
    <Route path="developers/:tab" element={<DevelopersPage />} />
    <Route path="onboarding" element={<OnboardingPage />} />
    <Route path="time" element={<TimePage />} />
    <Route path="approvals" element={<ApprovalsPage />} />
  </>
);
