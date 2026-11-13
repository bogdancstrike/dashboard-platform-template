import { Route } from "react-router-dom";

import { lazyPage } from "./lazyPage";

const RecordGridPage = lazyPage(() => import("@/pages/recordsAnalytics/RecordGridPage"));
const EntityDetailPage = lazyPage(() => import("@/pages/EntityDetailPage"));
const ComparePage = lazyPage(() => import("@/pages/ComparePage"));

/**
 * Six datasets, six pages (§7).
 *
 * These share their data layer — `useEntityView`, the same query, the same URL
 * keys — and share no layout at all, because a board, a portfolio timeline, an
 * account book, a ledger, a triage queue and a fleet monitor are six jobs.
 */
const TasksBoardPage = lazyPage(() => import("@/pages/entities/TasksBoardPage"));
// Tasks get their own detail page: it is the record people work *in* (§8, §18, §36).
const TaskDetailPage = lazyPage(() => import("@/pages/entities/TaskDetailPage"));
const ProjectDeliveryPage = lazyPage(() => import("@/pages/entities/ProjectDeliveryPage"));
const TicketConsolePage = lazyPage(() => import("@/pages/entities/TicketConsolePage"));
const ProjectsPortfolioPage = lazyPage(() => import("@/pages/entities/ProjectsPortfolioPage"));
const CustomersPage = lazyPage(() => import("@/pages/entities/CustomersPage"));
const OrdersLedgerPage = lazyPage(() => import("@/pages/entities/OrdersLedgerPage"));
const TicketsQueuePage = lazyPage(() => import("@/pages/entities/TicketsQueuePage"));
const DevicesFleetPage = lazyPage(() => import("@/pages/entities/DevicesFleetPage"));

/**
 * Where the record itself has a shape — a delivery review, a support console —
 * the detail is its own page; the rest read the generic one, which renders
 * whatever the declaration publishes (§8).
 */
const ENTITIES = [
  { path: "projects", key: "project", list: <ProjectsPortfolioPage />, detail: <ProjectDeliveryPage /> },
  { path: "tickets", key: "ticket", list: <TicketsQueuePage />, detail: <TicketConsolePage /> },
  { path: "customers", key: "customer", list: <CustomersPage /> },
  { path: "orders", key: "order", list: <OrdersLedgerPage /> },
  { path: "devices", key: "device", list: <DevicesFleetPage /> },
];

/** Records — six datasets, six pages (§7, §8), and comparing them (§47). */
export const recordRoutes = (
  <>
    <Route path="tasks">
      <Route path="grid" element={<RecordGridPage resourceKey="task" />} />
      <Route index element={<TasksBoardPage />} />
      <Route path=":id" element={<TaskDetailPage />} />
    </Route>
    {ENTITIES.map((entity) => (
      <Route key={entity.path} path={entity.path}>
        <Route index element={entity.list} />
        <Route path="grid" element={<RecordGridPage resourceKey={entity.key} />} />
        <Route path=":id" element={entity.detail ?? <EntityDetailPage resourceKey={entity.key} />} />
      </Route>
    ))}
    {/* Two or more records side by side (§47): one address, the dataset a parameter. */}
    <Route path="compare" element={<ComparePage />} />
  </>
);
