import { api } from "./client";
import type { AutomationRule, AutomationRun } from "./automations";

/**
 * Workflows as node graphs (§49) — what the canvas reads and writes.
 *
 * One stored definition: the published graph is what runs, the draft is what
 * the canvas is editing, and the form editor edits the straight-line case of
 * the same thing. See `services/automation_graph.py`.
 */

export type NodeType = "trigger" | "condition" | "branch" | "action";

export interface GraphNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  /** Which output: `out`, `true` / `false` on a branch, `approved` / `rejected`. */
  port: string;
  target: string;
}

export interface WorkflowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphProblem {
  /** "" for a problem with the whole graph. */
  node_id: string;
  message: string;
}

export interface NodeStats {
  runs: number;
  nodes: Record<string, Record<string, number>>;
  edges: Record<string, number>;
}

export interface GraphVersion {
  version: number;
  published_at: string | null;
  note: string | null;
  by: string | null;
  nodes: number;
}

export interface GraphDetail {
  rule: AutomationRule;
  draft: WorkflowGraph;
  published: WorkflowGraph | null;
  version: number;
  published_at: string | null;
  published_by: string | null;
  draft_updated_at: string | null;
  dirty: boolean;
  problems: GraphProblem[];
  versions: GraphVersion[];
  stats: NodeStats;
  webhook_path: string | null;
  can_edit: boolean;
}

export interface TraceStep {
  node_id: string;
  state: string;
  detail: string;
}

export interface TraceResult {
  record: { id: string; label: string; path: string };
  nodes: TraceStep[];
  edges: string[];
  actions: Array<{ kind: string; ok: boolean; detail: string; node_id: string }>;
  error: string | null;
}

export const workflowGraphApi = {
  get: (id: string, signal?: AbortSignal) =>
    api.get<GraphDetail>(`/api/automations/rules/${id}/graph`, { signal }),
  saveDraft: (id: string, graph: WorkflowGraph | null) =>
    api.put<GraphDetail>(`/api/automations/rules/${id}/graph`, { graph }),
  publish: (id: string, note?: string) =>
    api.post<GraphDetail>(`/api/automations/rules/${id}/publish`, { note: note ?? "" }),
  restore: (id: string, version: number) =>
    api.post<GraphDetail>(`/api/automations/rules/${id}/restore`, { version }),
  test: (id: string, recordId: string) =>
    api.post<TraceResult>(`/api/automations/rules/${id}/test`, { record_id: recordId }),
  samples: (id: string, q: string, signal?: AbortSignal) =>
    api.get<{ items: Array<{ id: string; label: string; status: string | null }> }>(
      `/api/automations/rules/${id}/samples`,
      { params: { q }, signal },
    ),
  create: (name: string, graph: WorkflowGraph) =>
    api.post<AutomationRule>("/api/automations/rules", { name, graph }),
  runScheduler: () =>
    api.post<{ scheduled: number; resumed: number; ran_at: string }>("/api/automations/scheduler", {}),
};

export type { AutomationRun };

/** What the canvas palette offers, published by `/api/automations/catalog`. */
export interface CanvasCatalogueExtras {
  canvas_actions: Array<{ kind: string; label: string; description: string; needs: string[] }>;
  triggers: Array<{ event: string; label: string; description: string; needs: string[] }>;
  flow: Array<{ kind: string; label: string; description: string; needs: string[]; ports: string[] }>;
  forms: Array<{ slug: string; name: string; target: string }>;
  approvals: boolean;
  limits_graph: { max_nodes: number; max_wait_minutes: number };
}
