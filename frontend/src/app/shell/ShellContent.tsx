import { Outlet, useLocation } from "react-router-dom";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import type { NavItem } from "@/app/navigation";
import { useAuth } from "@/auth/AuthProvider";
import { ProblemPage } from "@/components/ProblemPage";
import { flagForPath, useFeatures, type FeatureKey } from "@/settings/features";

/**
 * The page, or why the reader cannot have it.
 *
 * A route the reader's role cannot reach answers "forbidden" with the
 * permission it needed; a route behind a switched-off flag answers "switched
 * off" — any route a flag governs, not only menu entries: `/tasks/grid`,
 * `/workflows/:id/canvas` and `/assistant/:id` are reached by address too.
 */
export function ShellContent({ activeItem }: { activeItem: NavItem | undefined }) {
  const { pathname } = useLocation();
  const auth = useAuth();
  const features = useFeatures();
  const permission = activeItem?.permission;
  if (!auth.loading && permission && !auth.can(permission)) {
    return <ProblemPage kind="forbidden" missing={[permission]} />;
  }
  const routeFlag = flagForPath(pathname) ?? (activeItem?.flag as FeatureKey | undefined);
  if (!auth.loading && routeFlag && !features(routeFlag)) {
    return <ProblemPage kind="switched_off" />;
  }
  return (
    <ErrorBoundary resetKey={pathname}>
      <Outlet />
    </ErrorBoundary>
  );
}
