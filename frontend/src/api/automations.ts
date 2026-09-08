import { api } from "./client";
import type { QueryNode } from "@/components/explorer/queryTree";

/**
 * Automations — condition → action, on the same tree the search builds (§49).
 *
 * The condition is a `QueryNode`, which is the *same* type the advanced search
 * editor produces and `core/rules.py` compiles. That is the whole reason this
 * client imports from the explorer's tree module rather than declaring a shape
 * of its own: two structural types that happen to agree today are two things
 * that can stop agreeing, and the day they do, a rule saved in one editor
 * stops compiling in the other.
 *
 * See `services/workflows.py` for what the server does with these.
 */

/** One thing a rule does when it fires. */
export interface AutomationAction {
  kind: "NOTIFY" | "EMAIL" | "TASK" | "WEBHOOK";
  /**
   * Who it reaches. A *role* rather than a list of people is the option that
   * matters: an alert addressed by enumerating recipients silently misses
   * whoever joined the team afterwards.
   */
  recipients?: { user_ids: string[]; role: string; owner: boolean };
  title?: string;
  body?: string;
  subject?: string;
  template?: string;
  priority?: string;
  assignee_id?: string;
  url?: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  resource_type: string;
  resource_label: string;
  resource_path: string;
  /**
   * Whether the dataset it names still exists. A rule that outlived its
   * dataset can never fire; the page says so rather than reporting the
   * symptoms (no actions, a condition that will not compile) as faults.
   */
  resource_exists: boolean;
  enabled: boolean;
  severity: "INFO" | "WARNING" | "CRITICAL";
  condition_tree: QueryNode | null;
  /** Rendered by the same module that compiles the tree, so it cannot drift. */
  condition_text: string | null;
  condition_count: number;
  actions: AutomationAction[];
  action_summary: string[];
  /** Stored, not yet executed by anything: scheduling is §23. */
  schedule: string;
  cooldown_minutes: number;
  owner: { id: string | null; name: string | null };
  last_triggered_at: string | null;
  trigger_count: number;
  last_match_count: number;
  created_at: string | null;
  updated_at: string | null;
  /** The server's answer, so a control is absent for a reason it knows (§76). */
  can_edit: boolean;
}

/** One record a run touched, or deliberately did not. */
export interface AutomationOutcome {
  record: string;
  record_id: string;
  path: string;
  state: "FIRED" | "WOULD FIRE" | "SUPPRESSED";
  since?: string | null;
  actions: Array<{ kind: string; ok: boolean; detail: string }>;
}

export interface AutomationRun {
  id: string;
  rule_id: string;
  dry_run: boolean;
  started_at: string | null;
  finished_at: string | null;
  matched: number;
  fired: number;
  /** Matched, and held back because this record was acted on recently. */
  suppressed: number;
  /** Matched, and left for the next run rather than dropped. */
  deferred: number;
  /** Set when the *evaluation* failed. A failed action is in the sample. */
  error: string | null;
  capped: boolean;
  sample: AutomationOutcome[];
  by_action: Record<string, { ok: number; failed: number }>;
  triggered_by: string | null;
}

export interface AutomationDetail extends AutomationRule {
  runs: AutomationRun[];
  /** Which records are currently silenced, and until when. Derived. */
  cooling_down: Array<{
    record_id: string;
    record: string | null;
    last_fired_at: string | null;
    until: string | null;
    fire_count: number;
  }>;
}

export interface AutomationCatalogue {
  resources: Array<{ key: string; label: string; path: string }>;
  /**
   * Read from the roles table rather than `/admin/roles`, which needs
   * `roles.manage` — a permission a manager who may write automations does
   * not hold, and addressing an action to a role is the option that matters.
   */
  roles: Array<{ code: string; name: string }>;
  actions: Array<{ kind: string; label: string; description: string; needs: string[] }>;
  severities: string[];
  limits: { max_matches: number; max_fires: number; max_rules: number };
}

export interface AutomationList {
  items: AutomationRule[];
  total: number;
  counts: { total: number; enabled: number; fires: number };
  can_manage: boolean;
}

export type AutomationInput = Partial<
  Pick<
    AutomationRule,
    | "name"
    | "description"
    | "resource_type"
    | "condition_tree"
    | "actions"
    | "enabled"
    | "severity"
    | "schedule"
    | "cooldown_minutes"
  >
>;

export const automationsApi = {
  /** What a rule may watch and what it may do — both from declarations. */
  catalogue: (signal?: AbortSignal) =>
    api.get<AutomationCatalogue>("/api/automations/catalog", { signal }),
  list: (params: { resource_type?: string; state?: string }, signal?: AbortSignal) =>
    api.get<AutomationList>("/api/automations/rules", { params, signal }),
  get: (id: string, signal?: AbortSignal) =>
    api.get<AutomationDetail>(`/api/automations/rules/${id}`, { signal }),
  create: (body: AutomationInput) =>
    api.post<AutomationRule>("/api/automations/rules", body),
  update: (id: string, body: AutomationInput) =>
    api.put<AutomationRule>(`/api/automations/rules/${id}`, body),
  remove: (id: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/api/automations/rules/${id}`),
  /**
   * Evaluate now. A dry run by default, because that is the safe reading of
   * "run this" and the server defaults the same way.
   */
  run: (id: string, dryRun: boolean) =>
    api.post<AutomationRun>(`/api/automations/rules/${id}/run`, { dry_run: dryRun }),
  runs: (id: string, signal?: AbortSignal) =>
    api.get<{ items: AutomationRun[]; total: number }>(
      `/api/automations/rules/${id}/runs`,
      { signal },
    ),
};
