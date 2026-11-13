import { Navigate, Route } from "react-router-dom";

import { lazyPage } from "./lazyPage";
import { NotFound, ProblemRoute } from "./RouteHelpers";

const ImportPage = lazyPage(() => import("@/pages/ImportPage"));
const ExportsPage = lazyPage(() => import("@/pages/ExportsPage"));
const ShowcaseComponentsPage = lazyPage(() => import("@/pages/showcase/ComponentsPage"));
const ShowcaseTemplatesPage = lazyPage(() => import("@/pages/showcase/TemplatesPage"));
const ProfilePage = lazyPage(() => import("@/pages/ProfilePage"));
const PreferencesPage = lazyPage(() => import("@/pages/PreferencesPage"));
const SecurityPage = lazyPage(() => import("@/pages/SecurityPage"));

/** Data in and out, the template showcase, the reader's own account. */
export const accountRoutes = (
  <>
    <Route path="import" element={<ImportPage />} />
    <Route path="exports" element={<ExportsPage />} />
    <Route path="showcase/components" element={<ShowcaseComponentsPage />} />
    <Route path="showcase/templates" element={<ShowcaseTemplatesPage />} />
    <Route path="profile" element={<ProfilePage />} />
    {/* A colleague's, showing only what this reader may be told (§40). */}
    <Route path="profile/:userId" element={<ProfilePage />} />
    <Route path="settings/preferences" element={<PreferencesPage />} />
    <Route path="settings/security" element={<SecurityPage />} />
  </>
);

/** Redirects, the problem pages (one per address, §34) and the catch-all. */
export const systemRoutes = (
  <>
    <Route path="system" element={<Navigate to="/admin/health" replace />} />
    <Route path="errors/401" element={<ProblemRoute kind="unauthorized" />} />
    <Route path="errors/403" element={<ProblemRoute kind="forbidden" />} />
    <Route path="errors/404" element={<ProblemRoute kind="not_found" />} />
    <Route path="errors/500" element={<ProblemRoute kind="server" />} />
    <Route path="errors/maintenance" element={<ProblemRoute kind="maintenance" />} />
    <Route path="errors/session-expired" element={<ProblemRoute kind="session_expired" />} />
    <Route path="errors/switched-off" element={<ProblemRoute kind="switched_off" />} />
    <Route path="*" element={<NotFound />} />
  </>
);
