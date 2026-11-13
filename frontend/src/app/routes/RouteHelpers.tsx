import { Navigate, useParams } from "react-router-dom";

import { useAuth } from "@/auth/AuthProvider";
import { signInAgain } from "@/auth/keycloak";
import { ProblemPage, type ProblemKind } from "@/components/ProblemPage";
import { landingPath } from "@/pages/PreferencesPage";

import { RouteLoading } from "./lazyPage";

/**
 * A problem page as a route (§34).
 *
 * Two of the six cannot be reached by asking for them — a session ends when it
 * ends, and the API is down when it is down — so without an address they would
 * be screens nobody could look at until the day they mattered. They are also
 * where the application *sends* a reader: `keycloak.ts` goes to
 * `/errors/session-expired`.
 *
 * Written out one route per address rather than as `errors/:kind`: a
 * parameterised route is invisible to the template gallery's completeness test
 * (§61), which reads concrete paths.
 */
export function ProblemRoute({ kind }: { kind: ProblemKind }) {
  return (
    <ProblemPage
      kind={kind}
      // Retrying an address that is *demonstrating* a failure is a reload,
      // which is honest and proves the button does something.
      onRetry={() => window.location.reload()}
      // Not a reload: a revoked session is keyed on the identity provider's
      // own session id, and a browser holding the SSO cookie reloads straight
      // back into the same one.
      onSignIn={() => void signInAgain()}
      missing={kind === "forbidden" ? ["records.view"] : []}
    />
  );
}

/** The address nobody meant to ask for. */
export function NotFound() {
  return <ProblemPage kind="not_found" />;
}

/**
 * `/search/saved/:searchId` — the address a bookmarked saved search carries.
 *
 * A redirect that keeps what it was given: `?saved=` is what the explorer
 * loads a search from, so that is what this hands it (§38).
 */
export function SavedSearchLink() {
  const { searchId } = useParams();
  return <Navigate to={searchId ? `/explore?saved=${searchId}` : "/explore"} replace />;
}

/**
 * Where arriving with no address lands (§40).
 *
 * The preference is read rather than a route constant, and it waits for the
 * profile rather than guessing: redirecting to the dashboard and *then*
 * redirecting again would put a page in the back button nobody asked for.
 */
export function LandingRedirect() {
  const { profile, loading } = useAuth();
  if (loading) return <RouteLoading />;
  return <Navigate to={landingPath(profile?.preferences.defaults.landing_page)} replace />;
}
