import { Route } from "react-router-dom";

import { lazyPage } from "./lazyPage";

const AdminHomePage = lazyPage(() => import("@/pages/admin/AdminHomePage"));
const UsersPage = lazyPage(() => import("@/pages/UsersPage"));
const UserDetailPage = lazyPage(() => import("@/pages/UserDetailPage"));
const GroupsPage = lazyPage(() => import("@/pages/admin/GroupsPage"));
const RolesPage = lazyPage(() => import("@/pages/RolesPage"));
const OrganizationsPage = lazyPage(() => import("@/pages/admin/OrganizationsPage"));
const AuditExplorerPage = lazyPage(() => import("@/pages/AuditExplorerPage"));
const LogsPage = lazyPage(() => import("@/pages/admin/LogsPage"));
const JobsPage = lazyPage(() => import("@/pages/admin/JobsPage"));
const SystemPage = lazyPage(() => import("@/pages/SystemPage"));
const ApiClientsPage = lazyPage(() => import("@/pages/admin/ApiClientsPage"));
const IntegrationsPage = lazyPage(() => import("@/pages/admin/IntegrationsPage"));
const TagsPage = lazyPage(() => import("@/pages/admin/TagsPage"));
const QualityPage = lazyPage(() => import("@/pages/admin/QualityPage"));
const FlagsPage = lazyPage(() => import("@/pages/admin/FlagsPage"));
const SystemSettingsPage = lazyPage(() => import("@/pages/admin/SettingsPage"));
const SlaPoliciesPage = lazyPage(() => import("@/pages/decisions/SlaPoliciesPage"));
const FormsPage = lazyPage(() => import("@/pages/decisions/FormsPage"));
const FormDesignerPage = lazyPage(() => import("@/pages/decisions/FormDesignerPage"));

/** Administration, including the SLA and intake-form editors. */
export const adminRoutes = (
  <>
    <Route path="admin" element={<AdminHomePage />} />
    <Route path="admin/users">
      <Route index element={<UsersPage />} />
      <Route path=":id" element={<UserDetailPage />} />
    </Route>
    <Route path="admin/groups" element={<GroupsPage />} />
    <Route path="admin/roles" element={<RolesPage />} />
    <Route path="admin/organizations" element={<OrganizationsPage />} />
    <Route path="admin/audit" element={<AuditExplorerPage />} />
    <Route path="admin/logs" element={<LogsPage />} />
    <Route path="admin/jobs" element={<JobsPage />} />
    <Route path="admin/health" element={<SystemPage />} />
    <Route path="admin/api" element={<ApiClientsPage />} />
    <Route path="admin/integrations" element={<IntegrationsPage />} />
    <Route path="admin/tags" element={<TagsPage />} />
    <Route path="admin/quality" element={<QualityPage />} />
    <Route path="admin/flags" element={<FlagsPage />} />
    <Route path="admin/settings" element={<SystemSettingsPage />} />
    <Route path="admin/sla" element={<SlaPoliciesPage />} />
    <Route path="admin/forms" element={<FormsPage />} />
    <Route path="admin/forms/:id" element={<FormDesignerPage />} />
  </>
);
