import type { AutomationCatalogue } from "@/api/automations";
import type { CanvasCatalogueExtras, GraphDetail, GraphProblem, TraceResult } from "@/api/workflowGraph";
import type { CanvasOverlay } from "@/components/workflows/WorkflowCanvas";

export type Catalogue = AutomationCatalogue & CanvasCatalogueExtras;
export type Mode = "edit" | "test" | "history";

/** What a test-run step state looks like on its node. */
export const TRACE_TONE: Record<string, "ok" | "warn" | "bad" | "acc"> = {
  started: "acc", passed: "ok", yes: "ok", no: "warn", stopped: "warn", done: "ok", failed: "bad", waiting: "acc",
};

/** Run-history counts as badges: how many arrived, and how many failed. */
export function historyOverlay(detail: Pick<GraphDetail, "stats">): CanvasOverlay {
  const badges: CanvasOverlay["badges"] = {};
  for (const [id, counts] of Object.entries(detail.stats.nodes)) {
    const list: CanvasOverlay["badges"][string] = [];
    if (counts.in) list.push({ label: `${counts.in} in`, tone: "acc" });
    if (counts.failed) list.push({ label: `${counts.failed} failed`, tone: "bad" });
    if (counts.waiting) list.push({ label: `${counts.waiting} waiting`, tone: "warn" });
    badges[id] = list;
  }
  return { badges, edgeCounts: detail.stats.edges };
}

/** A test run as an overlay: the path lit, each step's state as a badge. */
export function traceOverlay(trace: TraceResult): CanvasOverlay {
  const badges: CanvasOverlay["badges"] = {};
  for (const step of trace.nodes) {
    badges[step.node_id] = [...(badges[step.node_id] ?? []), { label: step.state, tone: TRACE_TONE[step.state] ?? "acc" }];
  }
  return { badges, path: { nodes: new Set(trace.nodes.map((step) => step.node_id)), edges: new Set(trace.edges) } };
}

/**
 * The catalogue with the canvas's parts filled in. The form editor's page
 * shares this cache entry, and a catalogue from an API that predates the
 * canvas has none of them — the canvas then offers the form's actions only.
 */
export function withCanvas(catalogue: AutomationCatalogue & Partial<CanvasCatalogueExtras>): Catalogue {
  return {
    ...catalogue,
    canvas_actions: catalogue.canvas_actions ?? catalogue.actions,
    triggers: catalogue.triggers ?? [],
    flow: catalogue.flow ?? [],
    forms: catalogue.forms ?? [],
    approvals: catalogue.approvals ?? false,
    limits_graph: catalogue.limits_graph ?? { max_nodes: 60, max_wait_minutes: 43200 },
  };
}

export function problemsByNode(problems: GraphProblem[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const item of problems) out[item.node_id] = [...(out[item.node_id] ?? []), item.message];
  return out;
}
