import { Route } from "react-router-dom";

import { lazyPage } from "./lazyPage";

const DashboardsPage = lazyPage(() => import("@/pages/DashboardsPage"));
const ReportBuilderPage = lazyPage(() => import("@/pages/ReportBuilderPage"));
const ChartBuilderPage = lazyPage(() => import("@/pages/ChartBuilderPage"));
const MapsPage = lazyPage(() => import("@/pages/MapsPage"));
// Records & analytics (§12, §13, §22).
const CustomerHealthPage = lazyPage(() => import("@/pages/analytics/CustomerHealthPage"));
const ContractsPage = lazyPage(() => import("@/pages/analytics/ContractsPage"));
const ContractDetailPage = lazyPage(() => import("@/pages/analytics/ContractDetailPage"));
const AlertsPage = lazyPage(() => import("@/pages/analytics/AlertsPage"));
const WatchDetailPage = lazyPage(() => import("@/pages/analytics/WatchDetailPage"));

/** Analyse: the builders, and the records-analytics pages (§12, §13, §22). */
export const analyseRoutes = (
  <>
    <Route path="dashboards" element={<DashboardsPage />} />
    <Route path="reports/builder" element={<ReportBuilderPage />} />
    <Route path="charts/builder" element={<ChartBuilderPage />} />
    <Route path="maps" element={<MapsPage />} />
    <Route path="customers/health" element={<CustomerHealthPage />} />
    <Route path="contracts" element={<ContractsPage />} />
    <Route path="contracts/:id" element={<ContractDetailPage />} />
    <Route path="alerts" element={<AlertsPage />} />
    <Route path="alerts/:id" element={<WatchDetailPage />} />
  </>
);
