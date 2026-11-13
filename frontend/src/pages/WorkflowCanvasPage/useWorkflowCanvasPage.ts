import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useParams } from "react-router-dom";

import { automationsApi } from "@/api/automations";
import { explorerApi } from "@/api/explorer";
import { usePageCommands } from "@/commands/CommandContext";
import type { CanvasHandle } from "@/components/workflows/WorkflowCanvas";
import { addNode, summaryOf } from "@/components/workflows/graph";
import { apiMessageToast } from "@/lib/errors";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { historyOverlay, problemsByNode, traceOverlay, withCanvas, type Mode } from "./canvasOverlays";
import { buildPalette } from "./palette";
import { useWorkflowDraft } from "./useWorkflowDraft";
import { useWorkflowTest } from "./useWorkflowTest";

/** The canvas page's state: the draft, the catalogues, the mode, the selection, and adding a step. */
export function useWorkflowCanvasPage() {
  const { ruleId = "" } = useParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const canvas = useRef<CanvasHandle>(null);
  const draft = useWorkflowDraft(ruleId);
  const { graph, problems, trace, setTrace, detail, change, publish } = draft;
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("edit");
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 1280);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1280);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const catalogue = useQuery({
    queryKey: queryKeys.automationCatalogue(),
    queryFn: ({ signal }) => automationsApi.catalogue(signal),
    staleTime: STALE.minute,
  });
  const explorer = useQuery({
    queryKey: queryKeys.explorerCatalogue(),
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: STALE.minute,
  });

  const rename = useMutation({
    mutationFn: (name: string) => automationsApi.update(ruleId, { name }),
    onSuccess: () => { void detail.refetch(); void queryClient.invalidateQueries({ queryKey: queryKeys.automations() }); },
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => automationsApi.update(ruleId, { enabled }),
    onSuccess: (rule) => {
      void detail.refetch();
      void queryClient.invalidateQueries({ queryKey: queryKeys.automations() });
      message.success(rule.enabled ? `${rule.name} is live` : `${rule.name} is paused`);
    },
    onError: apiMessageToast(message, "That change was refused."),
  });

  const tester = useWorkflowTest(ruleId, mode === "test", draft.flush, setTrace);

  const data = detail.data;
  const cat = useMemo(() => (catalogue.data ? withCanvas(catalogue.data) : undefined), [catalogue.data]);
  const datasets = explorer.data?.items ?? [];
  const labels = useMemo(() => ({
    triggers: Object.fromEntries((cat?.triggers ?? []).map((item) => [item.event, item.label])),
    actions: Object.fromEntries([...(cat?.canvas_actions ?? []), ...(cat?.flow ?? [])].map((item) => [item.kind, item.label])),
    datasets: Object.fromEntries((cat?.resources ?? []).map((item) => [item.key, item.label])),
  }), [cat]);

  const summaries = useMemo(
    () => Object.fromEntries((graph?.nodes ?? []).map((node) => [node.id, summaryOf(node, labels)])),
    [graph, labels],
  );
  const byNode = useMemo(() => problemsByNode(problems), [problems]);
  const overlay = useMemo(() => {
    if (mode === "history" && data) return historyOverlay(data);
    if (mode === "test" && trace) return traceOverlay(trace);
    return null;
  }, [mode, data, trace]);

  const palette = useMemo(() => buildPalette(cat), [cat]);

  const add = (index: number, position?: { x: number; y: number }) => {
    const item = palette[index];
    if (!graph || !item) return;
    const at = position ?? canvas.current?.centre() ?? { x: 0, y: 0 };
    const result = addNode(graph, item.type, item.data, at);
    // Added after the selected step, wired in, when its free output allows.
    let next = result.graph;
    if (!position && selected) {
      const from = next.nodes.find((node) => node.id === selected);
      if (from && !next.edges.some((edge) => edge.source === selected && edge.port === "out") && from.type !== "branch") {
        next = { ...next, edges: [...next.edges, { id: `e-${selected}-out-${result.id}`, source: selected, port: "out", target: result.id }] };
        next = { ...next, nodes: next.nodes.map((node) => node.id === result.id ? { ...node, position: { x: from.position.x, y: from.position.y + 160 } } : node) };
      }
    }
    change(next);
    setSelected(result.id);
  };

  usePageCommands("workflow-canvas", [
    { id: "workflow-canvas.publish", label: "Publish this workflow", keywords: "canvas release version", run: () => publish.mutate() },
    { id: "workflow-canvas.layout", label: "Tidy the canvas", keywords: "auto layout arrange", run: () => canvas.current?.layout() },
    { id: "workflow-canvas.test", label: "Test this workflow with a record", keywords: "dry run trace", run: () => setMode("test") },
  ]);

  return {
    canvas, draft, tester, selected, setSelected, mode, setMode, narrow, data, cat, datasets,
    summaries, byNode, overlay, palette, add, rename, toggle,
  };
}
