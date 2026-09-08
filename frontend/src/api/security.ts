import { api } from "./client";

/**
 * The reader's own security page (§41).
 *
 * Four things worth knowing before reading the types.
 *
 * **No permission gates any of this.** Every call is scoped to the caller's own
 * account, and being signed in is the qualification for seeing your own
 * sessions. A security page that had to be granted would be one most people
 * never see, and its whole value is that the person whose account it is can
 * look without asking anybody.
 *
 * **`current` is derived from the request that fetched it.** Which session you
 * are reading the page *from* is a fact about that request, so the server
 * decides it — the stored column exists for the administrator's user drawer,
 * which has no request to derive it from, and this page never sees it.
 *
 * **`state` has three values and they are not interchangeable.** REVOKED is
 * somebody's decision, EXPIRED is time passing, ACTIVE is a live sign-in.
 * Collapsing the first two into "inactive" would hide the only one anybody
 * acted on.
 *
 * **Revoking works.** `UserSession`'s docstring claimed for a long time that a
 * revoked session is refused on its next request while nothing read the table
 * at all — so this page would have offered a button that left the device
 * signed in. `core/auth._touch_session` is what makes it true; these are only
 * the calls.
 *
 * See `services/security.py`.
 */

export type SessionState = "ACTIVE" | "EXPIRED" | "REVOKED";

export interface SignInSession {
  id: string;
  device: string;
  user_agent: string | null;
  ip_address: string | null;
  location: string | null;
  state: SessionState;
  /** Whether this is the session the page was fetched from. */
  current: boolean;
  trusted: boolean;
  signed_in_at: string | null;
  last_seen_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  /** Only a live session has anything to act on. */
  can_revoke: boolean;
}

export interface SessionList {
  items: SignInSession[];
  total: number;
  active: number;
  /** Live sessions other than this one — the number a page says out loud. */
  others: number;
  /** False for a token with no session claim, e.g. a machine credential. */
  current_known: boolean;
}

export interface RevokeOthersResult extends SessionList {
  revoked: number;
}

export interface SignIn {
  id: string;
  result: "SUCCESS" | "FAILURE";
  /** Why a failure failed. The difference between a typo and an attempt. */
  reason: string | null;
  method: string;
  device: string;
  ip_address: string | null;
  location: string | null;
  at: string | null;
}

export interface SignInPage {
  items: SignIn[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  facets: Record<string, Array<{ value: string; count: number }>>;
  /** How far back this page reaches. Not a retention policy — nothing is deleted. */
  window_days: number;
}

export type SecuritySeverity = "INFO" | "WARNING" | "CRITICAL";

export interface SecurityEvent {
  id: string;
  kind: string;
  severity: SecuritySeverity;
  title: string;
  description: string | null;
  ip_address: string | null;
  resolved: boolean;
  at: string | null;
  details: Record<string, unknown>;
}

export interface SecurityEventPage {
  items: SecurityEvent[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  facets: Record<string, Array<{ value: string; count: number }>>;
}

/** The three things worth knowing before scrolling. */
export interface SecurityOverview {
  window_days: number;
  active_sessions: number;
  other_sessions: number;
  current_known: boolean;
  failed_sign_ins: number;
  /** Whether the page should lead with the failures. Derived, not a threshold
   * the browser applies — see `FAILURES_WORTH_SAYING`. */
  failures_worth_saying: boolean;
  failure_addresses: string[];
  unresolved_events: number;
  last_signed_in_at: string | null;
  last_signed_in_from: string | null;
  last_signed_in_on: string | null;
}

export interface SignInQuery {
  [key: string]: unknown;
  result?: string;
  method?: string;
  device?: string;
  page?: number;
  page_size?: number;
}

export const securityApi = {
  overview: (signal?: AbortSignal) =>
    api.get<SecurityOverview>("/security/overview", { signal }),
  sessions: (signal?: AbortSignal) =>
    api.get<SessionList>("/security/sessions", { signal }),
  /** Sign one device out. Enforced on its next request, not merely recorded. */
  revoke: (id: string) => api.delete<SignInSession>(`/security/sessions/${id}`),
  /** Sign out everywhere else, keeping this session. */
  revokeOthers: () =>
    api.post<RevokeOthersResult>("/security/sessions/revoke-others", {}),
  /** A note to yourself: nothing treats a trusted session differently. */
  trust: (id: string, trusted: boolean) =>
    api.put<SignInSession>(`/security/sessions/${id}`, { trusted }),
  signIns: (params: SignInQuery = {}, signal?: AbortSignal) =>
    api.get<SignInPage>("/security/sign-ins", { params, signal }),
  events: (params: Record<string, unknown> = {}, signal?: AbortSignal) =>
    api.get<SecurityEventPage>("/security/events", { params, signal }),
  /** Reversible, and not a delete. */
  resolve: (id: string, resolved: boolean) =>
    api.put<SecurityEvent>(`/security/events/${id}`, { resolved }),
};
