/** Customer health (§12): the portfolio, one customer's score and the scoring model. */

import { api } from "../client";

export type HealthBand = "HEALTHY" | "AT_RISK" | "CRITICAL";
export type HealthSignal = "tickets" | "orders" | "usage" | "renewal";

export interface HealthFact {
  text: string;
  impact: number;
}

export interface HealthComponent {
  key: HealthSignal;
  label: string;
  score: number;
  weight: number;
  share: number;
  contribution: number;
  facts: HealthFact[];
  inputs: Record<string, unknown>;
}

export interface CustomerHealth {
  customer: { id: string; name: string; code: string };
  score: number;
  band: HealthBand;
  band_label: string;
  previous_band: HealthBand | null;
  band_changed_at: string | null;
  delta_7d: number | null;
  delta_30d: number | null;
  computed_at: string | null;
  components: HealthComponent[];
  trend: { day: string; score: number; band: HealthBand; components: Record<string, number> }[];
  thresholds: { healthy: number; at_risk: number };
}

export interface PortfolioEntry {
  id: string;
  name: string;
  code: string;
  segment: string;
  score: number;
  band: HealthBand;
  previous_band: HealthBand | null;
  delta_7d: number | null;
  delta_30d: number | null;
  lifetime_value: number;
  band_changed_at: string | null;
}

export interface HealthPortfolio {
  total: number;
  average: number | null;
  distribution: { band: HealthBand; label: string; count: number }[];
  histogram: { from: number; to: number; count: number }[];
  movers: { period: "7d" | "30d"; up: PortfolioEntry[]; down: PortfolioEntry[] };
  drops: PortfolioEntry[];
  items: PortfolioEntry[];
  matching: number;
  page: number;
  page_size: number;
  computed_at: string | null;
  thresholds: { healthy: number; at_risk: number };
  can_configure: boolean;
}

export interface HealthModel {
  id: string;
  name: string;
  weights: Record<HealthSignal, number>;
  thresholds: {
    bands: { healthy: number; at_risk: number };
    tickets: { open: number; escalated: number; breached: number };
    orders: { recency_days: number; window_days: number };
    usage: { contact_days: number };
    renewal: { window_days: number };
  };
  signals: { key: HealthSignal; label: string }[];
  bands: { key: HealthBand; label: string }[];
  updated_at: string | null;
  can_configure: boolean;
}

export const healthApi = {
  portfolio: (params: Record<string, unknown>, signal?: AbortSignal) =>
    api.get<HealthPortfolio>("/api/customer-health", { params, signal }),
  customer: (id: string, days = 90, signal?: AbortSignal) =>
    api.get<CustomerHealth>(`/api/customer-health/customers/${id}`, { params: { days }, signal }),
  model: (signal?: AbortSignal) => api.get<HealthModel>("/api/customer-health/model", { signal }),
  saveModel: (body: Partial<Pick<HealthModel, "name" | "weights">> & { thresholds?: Partial<HealthModel["thresholds"]> }) =>
    api.put<HealthModel & { recomputed: { customers: number } }>("/api/customer-health/model", body),
  recompute: () => api.post<{ status: string; customers: number; dropped: number }>("/api/customer-health/recompute"),
};

export const BAND_LABEL: Record<HealthBand, string> = {
  HEALTHY: "Healthy",
  AT_RISK: "At risk",
  CRITICAL: "Critical",
};
