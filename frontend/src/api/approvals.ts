import { api } from "./client";

/**
 * The approvals inbox (Time & decisions). One queue for every decision —
 * timesheets, access requests, held-back record edits, report publishing —
 * with the kinds coming from the server's provider registry rather than from
 * a list here. See `services/approvals.py`.
 */

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
export type ApprovalScope = "inbox" | "mine" | "history" | "all";
export type Standing = "ok" | "due_soon" | "overdue" | "decided";

export interface Person {
  id: string;
  name: string;
  avatar_url: string | null;
  job_title: string | null;
}

export interface Approval {
  id: string;
  reference: string;
  kind: string;
  kind_label: string;
  icon: string;
  status: ApprovalStatus;
  title: string;
  summary: string;
  requester: Person | null;
  assignee: Person | null;
  decided_by: Person | null;
  subject_type: string | null;
  subject_id: string | null;
  subject_label: string | null;
  link: string | null;
  created_at: string | null;
  due_at: string | null;
  decided_at: string | null;
  decision_comment: string;
  age_hours: number;
  due_in_hours: number | null;
  standing: Standing;
  can_decide: boolean;
  can_withdraw: boolean;
  mine: boolean;
}

export interface HistoryEvent {
  at: string | null;
  action: string;
  actor_id: string | null;
  actor_label: string;
  comment: string;
}

export interface ApprovalDetail extends Approval {
  history: HistoryEvent[];
  payload: Record<string, unknown>;
  details: {
    facts?: { label: string; value: string }[];
    changes?: { field: string; before: unknown; after: unknown }[];
    days?: { date: string; minutes: number }[];
    subjects?: { label: string; minutes: number }[];
  };
}

export interface ApprovalKind {
  kind: string;
  label: string;
  icon: string;
  can_decide: boolean;
  sla_hours: number;
}

export interface ApprovalList {
  items: Approval[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  scope: ApprovalScope;
  facets: { kind: Record<string, number>; requester: { id: string; name: string; count: number }[] };
  kinds: ApprovalKind[];
  counts: { inbox: number; overdue: number; mine_pending: number };
}

export interface ChangeRule {
  id: string;
  name: string;
  description: string;
  resource_type: string;
  field: string;
  operator: "ANY" | "EQUALS" | "IN" | "GT" | "LT";
  value: unknown;
  active: boolean;
  created_at: string | null;
}

export interface RuleCatalogue {
  items: ChangeRule[];
  catalogue: {
    resource_type: string;
    label: string;
    fields: { name: string; label: string; kind: string; choices: string[] }[];
  }[];
  operators: ChangeRule["operator"][];
  can_manage: boolean;
}

export interface ApprovalQuery {
  scope?: ApprovalScope;
  kind?: string;
  requester_id?: string;
  age?: string;
  q?: string;
  page?: number;
  page_size?: number;
  sort?: string;
  order?: "asc" | "desc";
}

const A = "/api/approvals";

export const approvalsApi = {
  list: (query: ApprovalQuery, signal?: AbortSignal) =>
    api.get<ApprovalList>(A, { params: { ...query }, signal }),
  get: (id: string, signal?: AbortSignal) => api.get<ApprovalDetail>(`${A}/${id}`, { signal }),
  decide: (id: string, decision: "approve" | "reject", comment: string) =>
    api.post<ApprovalDetail>(`${A}/${id}/decision`, { decision, comment }),
  bulk: (ids: string[], decision: "approve" | "reject", comment: string) =>
    api.post<{ decided: number; failed: number; results: { id: string; ok: boolean; error?: string }[] }>(
      `${A}/bulk`,
      { ids, decision, comment },
    ),
  withdraw: (id: string) => api.post<ApprovalDetail>(`${A}/${id}/withdraw`),
  requestAccess: (body: { permission: string; path?: string; reason?: string }) =>
    api.post<Approval & { already_pending: boolean }>(`${A}/access`, body),
  requestPublish: (body: { report_id: string; reason?: string }) =>
    api.post<Approval & { already_pending: boolean }>(`${A}/report-publish`, body),
  rules: (signal?: AbortSignal) => api.get<RuleCatalogue>(`${A}/rules`, { signal }),
  createRule: (body: Partial<ChangeRule>) => api.post<ChangeRule>(`${A}/rules`, body),
  updateRule: (id: string, body: Partial<ChangeRule>) => api.put<ChangeRule>(`${A}/rules/${id}`, body),
  deleteRule: (id: string) => api.delete<{ id: string; removed: boolean }>(`${A}/rules/${id}`),
};

/** "3h", "2d" — how long something has been waiting. */
export function age(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
