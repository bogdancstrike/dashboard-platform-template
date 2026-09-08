import { api } from "./client";

/**
 * Connected systems (§26).
 *
 * Three things to keep in mind reading these types.
 *
 * **`state` is derived; `status` is not sent.** Whether an integration has what
 * it needs is a fact about its settings, and the stored column used to
 * contradict it — three of twelve rows said `NOT_CONFIGURED` while holding
 * every setting they required. The server computes it, so the browser has
 * nothing to reconcile.
 *
 * **`enabled` is intent and `state` is outcome.** Which makes "switched on and
 * failing" a state that exists — and the row an operator most needs, so the
 * page must not smooth the two into one word.
 *
 * **A check does not contact the provider, and says so.** `reached_provider`
 * is always `false` in this template: nothing here holds real credentials, and
 * a screen reporting "Connected to Stripe" when no packet left the process
 * would be the worst possible lie on it. The type says `false` rather than
 * `boolean` so a reader cannot miss it.
 *
 * See `services/integrations.py`.
 */

export type IntegrationState =
  | "NOT_CONFIGURED"
  | "DISCONNECTED"
  | "CONNECTED"
  | "ERROR";

export interface Integration {
  id: string;
  key: string;
  name: string;
  provider: string;
  category: string;
  description: string | null;
  /** What somebody asked for. */
  enabled: boolean;
  /** What is actually true, derived — see the module note. */
  state: IntegrationState;
  configured: boolean;
  /** Exactly which required settings are absent. */
  missing_settings: string[];
  required_settings: string[];
  last_connected_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  icon: string | null;
  docs_url: string | null;
}

export interface IntegrationDetail extends Integration {
  /** Values whose *names* say they are sensitive come back as the redaction. */
  configuration: Record<string, unknown>;
  /** Which keys were redacted, so the page can say "set, not shown". */
  redacted_settings: string[];
}

export interface IntegrationsPage {
  items: Integration[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  facets: Record<string, Array<{ value: string; count: number }>>;
  columns: string[];
}

export interface IntegrationCatalogue {
  fields: Array<{ name: string; label: string; kind: string }>;
  default_columns: string[];
  categories: Array<{ key: string; count: number }>;
  /** Counted on the *derived* state, so the chips agree with the rows. */
  states: Array<{ key: IntegrationState; count: number }>;
  total: number;
  /** Switched on and not connected — the reason to open this page. */
  needing_attention: number;
  /** The string a redacted value reads as, so the page can recognise it. */
  redacted: string;
}

/** What a configuration check established, and what it did not. */
export interface CheckResult extends Integration {
  /** Always `false` here. See the module note. */
  reached_provider: false;
  checked_at: string;
  note: string;
}

export interface IntegrationQuery {
  [key: string]: unknown;
  q?: string;
  category?: string;
  status?: string;
  page?: number;
  page_size?: number;
}

export const integrationsApi = {
  catalogue: (signal?: AbortSignal) =>
    api.get<IntegrationCatalogue>("/admin/integrations/catalogue", { signal }),
  list: (params: IntegrationQuery = {}, signal?: AbortSignal) =>
    api.get<IntegrationsPage>("/admin/integrations", { params, signal }),
  entry: (id: string, signal?: AbortSignal) =>
    api.get<IntegrationDetail>(`/admin/integrations/${id}`, { signal }),
  /**
   * Merged, not replaced. Sending a redacted value back means "leave it
   * alone" — otherwise showing a masked token once would destroy it.
   */
  configure: (id: string, configuration: Record<string, unknown>) =>
    api.put<IntegrationDetail>(`/admin/integrations/${id}`, { configuration }),
  /** Refused while required settings are missing, with those named. */
  setEnabled: (id: string, enabled: boolean) =>
    api.put<Integration>(`/admin/integrations/${id}/enabled`, { enabled }),
  /** Verifies the configuration. Does not contact the provider. */
  check: (id: string) => api.post<CheckResult>(`/admin/integrations/${id}/check`, {}),
};
