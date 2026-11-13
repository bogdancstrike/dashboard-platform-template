import { api } from "./client";

/**
 * SLA policies and business-hours calendars (Time & decisions). A ticket's
 * deadline is computed on the server from the first policy that matches it;
 * `ticket` answers which one, and the time left counted in business hours.
 * See `services/sla.py`.
 */

export type Priority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type EscalationAction = "NOTIFY" | "ASSIGN" | "RAISE_PRIORITY";

export interface Escalation {
  at_percent: number;
  action: EscalationAction;
  target?: "assignee" | "manager" | "user";
  user_id?: string;
}

export interface Targets {
  first_response?: number;
  resolution?: number;
}

export interface SlaPolicy {
  id: string;
  name: string;
  description: string;
  position: number;
  active: boolean;
  conditions: { customer_ids?: string[]; segments?: string[]; categories?: string[]; channels?: string[] };
  targets: Partial<Record<Priority, Targets>>;
  calendar_id: string | null;
  calendar_name: string | null;
  pause_statuses: string[];
  escalations: Escalation[];
  covered_open: number;
  breached_open: number;
  updated_at: string | null;
}

export interface BusinessCalendar {
  id: string;
  name: string;
  timezone: string;
  hours: Record<string, [string, string][]>;
  holidays: { date: string; name: string }[];
  is_default: boolean;
  weekly_minutes: number;
  used_by: number;
  updated_at: string | null;
}

export interface SlaOverview {
  items: SlaPolicy[];
  calendars: BusinessCalendar[];
  uncovered_open: number;
  can_manage: boolean;
}

export interface SlaCatalogue {
  priorities: Priority[];
  categories: string[];
  channels: string[];
  segments: string[];
  statuses: string[];
  actions: EscalationAction[];
  notify_targets: string[];
  days: string[];
  timezones: string[];
  customers: { id: string; name: string; segment: string }[];
  can_manage: boolean;
}

export interface Clock {
  due_at: string;
  met: boolean;
  breached: boolean;
  done_at: string | null;
  business_minutes_left: number | null;
}

export interface TicketSla {
  ticket_id: string;
  policy: { id: string; name: string; description: string } | null;
  calendar: { id: string; name: string; timezone: string } | null;
  priority: Priority;
  targets: Targets;
  first_response: Clock | null;
  resolution: Clock | null;
  paused: boolean;
  paused_since: string | null;
  paused_minutes: number;
  pause_statuses: string[];
  percent_elapsed: number | null;
  in_business_hours: boolean;
  escalations: (Escalation & { fired: boolean })[];
  computed_at: string | null;
}

const S = "/api/sla";

export const slaApi = {
  catalogue: (signal?: AbortSignal) => api.get<SlaCatalogue>(`${S}/catalogue`, { signal }),
  overview: (signal?: AbortSignal) => api.get<SlaOverview>(`${S}/policies`, { signal }),
  create: (body: Partial<SlaPolicy>) => api.post<SlaPolicy>(`${S}/policies`, body),
  update: (id: string, body: Partial<SlaPolicy>) => api.put<SlaPolicy>(`${S}/policies/${id}`, body),
  remove: (id: string) => api.delete<{ removed: boolean }>(`${S}/policies/${id}`),
  reorder: (ids: string[]) => api.put<SlaOverview>(`${S}/policies/order`, { ids }),
  createCalendar: (body: Partial<BusinessCalendar>) => api.post<BusinessCalendar>(`${S}/calendars`, body),
  updateCalendar: (id: string, body: Partial<BusinessCalendar>) =>
    api.put<BusinessCalendar>(`${S}/calendars/${id}`, body),
  removeCalendar: (id: string) => api.delete<{ removed: boolean }>(`${S}/calendars/${id}`),
  apply: () => api.post<{ tickets: number; covered: number; escalations: { fired: number } }>(`${S}/apply`),
  ticket: (id: string, signal?: AbortSignal) => api.get<TicketSla>(`${S}/tickets/${id}`, { signal }),
};

/** Business minutes as a target reads: 90 → "1h 30m", 2880 → "2d" (8h days are not assumed). */
export function target(minutes: number | undefined): string {
  if (!minutes) return "—";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
