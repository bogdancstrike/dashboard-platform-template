/** Contracts and renewals (§13): the board, list, forecast, calendar and files. */

import { api } from "../client";

import type { HealthBand } from "./health";

export type ContractStage = "UPCOMING" | "NEGOTIATION" | "COMMITTED" | "RENEWED" | "CHURNED";

export interface ContractCard {
  id: string;
  reference: string;
  title: string;
  customer: { id: string; name: string | null; code: string | null };
  owner: { id: string | null; name: string | null };
  value: number;
  weighted: number;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  days_to_end: number | null;
  stage: ContractStage;
  stage_label: string;
  probability: number;
  rank: number;
  auto_renew: boolean;
  health_band: HealthBand | null;
  health_score: number | null;
  at_risk: boolean;
  updated_at: string | null;
}

export interface ContractDetail extends ContractCard {
  term_months: number;
  billing: string;
  notice_days: number;
  notice_by: string | null;
  terms: string | null;
  notes: string | null;
  churn_reason: string | null;
  stage_changed_at: string | null;
  closed_at: string | null;
  folder_id: string | null;
  created_at: string | null;
  can_edit: boolean;
}

export interface ContractSummary {
  open: number;
  pipeline: number;
  weighted: number;
  at_risk: number;
  at_risk_value: number;
  due_90: number;
}

export interface ContractColumn {
  stage: ContractStage;
  label: string;
  probability: number;
  count: number;
  value: number;
  weighted: number;
  at_risk: number;
  cards: ContractCard[];
}

export interface ContractBoard {
  columns: ContractColumn[];
  summary: ContractSummary;
  can_manage: boolean;
}

export interface ContractList {
  items: ContractCard[];
  total: number;
  page: number;
  page_size: number;
  summary: ContractSummary;
  stages: { key: ContractStage; label: string }[];
  can_manage: boolean;
}

export interface ForecastQuarter {
  key: string;
  label: string;
  current: boolean;
  past: boolean;
  pipeline: number;
  weighted: number;
  committed: number;
  renewed: number;
  churned: number;
  at_risk: number;
  count: number;
}

export interface ContractForecast {
  quarters: ForecastQuarter[];
  totals: Record<"pipeline" | "weighted" | "committed" | "renewed" | "churned" | "at_risk", number>;
}

export interface ContractCalendar {
  month: string;
  from: string;
  to: string;
  events: { day: string; kind: "END" | "NOTICE"; contract: ContractCard }[];
}

export interface ContractFile {
  id: string;
  name: string;
  extension: string | null;
  kind: string;
  size_bytes: number;
  status: string;
  owner: string | null;
  created_at: string | null;
}

export type ContractInput = Partial<{
  title: string;
  customer_id: string;
  owner_id: string | null;
  value: number | string;
  currency: string;
  start_date: string;
  end_date: string;
  term_months: number;
  billing: string;
  auto_renew: boolean;
  notice_days: number;
  stage: ContractStage;
  probability: number;
  terms: string | null;
  notes: string | null;
  churn_reason: string | null;
  expected_updated_at: string | null;
}>;

export const contractsApi = {
  list: (params: Record<string, unknown>, signal?: AbortSignal) =>
    api.get<ContractList>("/api/contracts", { params, signal }),
  board: (params: Record<string, unknown>, signal?: AbortSignal) =>
    api.get<ContractBoard>("/api/contracts/board", { params, signal }),
  forecast: (params: Record<string, unknown>, signal?: AbortSignal) =>
    api.get<ContractForecast>("/api/contracts/forecast", { params, signal }),
  calendar: (params: Record<string, unknown>, signal?: AbortSignal) =>
    api.get<ContractCalendar>("/api/contracts/calendar", { params, signal }),
  get: (id: string, signal?: AbortSignal) => api.get<ContractDetail>(`/api/contracts/${id}`, { signal }),
  create: (body: ContractInput) => api.post<ContractDetail>("/api/contracts", body),
  update: (id: string, body: ContractInput) => api.put<ContractDetail>(`/api/contracts/${id}`, body),
  remove: (id: string) => api.delete<{ id: string; deleted: boolean }>(`/api/contracts/${id}`),
  move: (id: string, body: { stage: ContractStage; before_id?: string | null; probability?: number; churn_reason?: string }) =>
    api.post<ContractDetail>(`/api/contracts/${id}/move`, body),
  files: (id: string, signal?: AbortSignal) =>
    api.get<{ folder_id: string | null; items: ContractFile[]; can_upload: boolean }>(`/api/contracts/${id}/files`, { signal }),
  folder: (id: string) => api.post<{ folder_id: string }>(`/api/contracts/${id}/files`),
};

export const STAGE_ORDER: ContractStage[] = ["UPCOMING", "NEGOTIATION", "COMMITTED", "RENEWED", "CHURNED"];
export const STAGE_LABEL: Record<ContractStage, string> = {
  UPCOMING: "Upcoming",
  NEGOTIATION: "In negotiation",
  COMMITTED: "Committed",
  RENEWED: "Renewed",
  CHURNED: "Churned",
};
