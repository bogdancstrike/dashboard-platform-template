/**
 * `/workflows/:ruleId/canvas` — an automation as a node graph (§49).
 *
 * The form editor asks for one sentence; the canvas draws a small program — a
 * trigger, conditions, if/else branches, actions, delays, approvals — on the
 * same stored definition. Four decisions:
 *
 * **Every edit is a draft, saved as you go.** Nothing runs until Publish, which
 * the server refuses per node if the graph cannot run; every publish is a
 * version that can be restored. A half-drawn workflow must never fire.
 *
 * **Problems are painted where they are.** The server validates the draft on
 * every save and names the node; the canvas rings it and the inspector says
 * what to fix — rather than a save-time refusal somebody has to decode.
 *
 * **Test is a walk, not a guess.** Pick a real record and the server walks it
 * through the draft with the actions switched off; the path it took lights up.
 *
 * **History is counts on the graph.** How many records reached each step over
 * recent runs, and which way each branch sent them — the answer to "is this
 * doing anything" drawn on the thing itself.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Segmented,
  Select,
  Skeleton,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { automationsApi, type AutomationCatalogue } from "@/api/automations";
import { ApiError } from "@/api/client";
import { explorerApi } from "@/api/explorer";
import {
  workflowGraphApi,
  type CanvasCatalogueExtras,
  type GraphDetail,
  type GraphProblem,
  type TraceResult,
  type WorkflowGraph,
} from "@/api/workflowGraph";
import { useSmartBack } from "@/app/history";
import { usePageCommands } from "@/commands/CommandContext";
import { NxIcon, type NxIconName } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { ProblemPage } from "@/components/ProblemPage";
import { NodeInspector } from "@/components/workflows/NodeInspector";
import { DRAG_TYPE, WorkflowCanvas, type CanvasHandle, type CanvasOverlay } from "@/components/workflows/WorkflowCanvas";
import { addNode, blankData, iconFor, str, summaryOf } from "@/components/workflows/graph";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { relativeTime } from "@/lib/time";
import "@/styles/workflows.css";

const { Text } = Typography;

type Catalogue = AutomationCatalogue & CanvasCatalogueExtras;
type Mode = "edit" | "test" | "history";

/** What a test-run step state looks like on its node. */
const TRACE_TONE: Record<string, "ok" | "warn" | "bad" | "acc"> = {
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

export default function WorkflowCanvasPage() {
  const { ruleId = "" } = useParams();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const back = useSmartBack();
  const canvas = useRef<CanvasHandle>(null);

  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("edit");
  const [problems, setProblems] = useState<GraphProblem[]>([]);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [sample, setSample] = useState<string | undefined>();
  const [sampleSearch, setSampleSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 1280);
  const edits = useRef(0);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1280);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const detail = useQuery({
    queryKey: ["workflow-graph", ruleId],
    queryFn: ({ signal }) => workflowGraphApi.get(ruleId, signal),
    enabled: Boolean(ruleId),
  });
  const catalogue = useQuery({
    queryKey: ["automation-catalogue"],
    queryFn: ({ signal }) => automationsApi.catalogue(signal),
    staleTime: 60_000,
  });
  const explorer = useQuery({
    queryKey: ["explorer-catalogue"],
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: 60_000,
  });

  // Load once: after that the canvas's own state is the truth, and a save's
  // answer only refreshes what the server knows better (problems, versions).
  useEffect(() => {
    if (detail.data && graph === null) {
      setGraph(detail.data.draft);
      setProblems(detail.data.problems);
    }
  }, [detail.data, graph]);

  const accept = useCallback((next: GraphDetail) => {
    queryClient.setQueryData(["workflow-graph", ruleId], next);
    setProblems(next.problems);
  }, [queryClient, ruleId]);

  const save = useMutation({
    mutationFn: (next: WorkflowGraph) => workflowGraphApi.saveDraft(ruleId, next),
    onSuccess: (next) => { accept(next); setPending(false); },
    onError: (error) => {
      setPending(false);
      message.error(error instanceof ApiError ? error.message : "The draft could not be saved.");
    },
  });

  const debounced = useDebouncedValue(graph, 700);
  useEffect(() => {
    if (debounced && edits.current > 0 && detail.data?.can_edit) {
      edits.current = 0;
      save.mutate(debounced);
    }
    // `save` is stable enough; depending on it would re-save on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const change = (next: WorkflowGraph) => {
    edits.current += 1;
    setPending(true);
    setGraph(next);
    setTrace(null);
  };

  const publish = useMutation({
    mutationFn: async () => {
      if (graph && (edits.current > 0 || pending)) {
        edits.current = 0;
        accept(await workflowGraphApi.saveDraft(ruleId, graph));
        setPending(false);
      }
      return workflowGraphApi.publish(ruleId);
    },
    onSuccess: (next) => {
      accept(next);
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
      message.success(`Published version ${next.version}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && Array.isArray(error.details.problems)) {
        setProblems(error.details.problems as GraphProblem[]);
      }
      message.error(error instanceof ApiError ? error.message : "That could not be published.");
    },
  });

  const discard = useMutation({
    mutationFn: () => workflowGraphApi.saveDraft(ruleId, null),
    onSuccess: (next) => { accept(next); setGraph(next.draft); edits.current = 0; message.info("Draft discarded"); },
  });

  const restore = useMutation({
    mutationFn: (version: number) => workflowGraphApi.restore(ruleId, version),
    onSuccess: (next) => { accept(next); setGraph(next.draft); edits.current = 0; message.success("Restored into the draft — publish to make it live."); },
  });

  const rename = useMutation({
    mutationFn: (name: string) => automationsApi.update(ruleId, { name }),
    onSuccess: () => { void detail.refetch(); void queryClient.invalidateQueries({ queryKey: ["automations"] }); },
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => automationsApi.update(ruleId, { enabled }),
    onSuccess: (rule) => {
      void detail.refetch();
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
      message.success(rule.enabled ? `${rule.name} is live` : `${rule.name} is paused`);
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : "That change was refused."),
  });

  const samples = useQuery({
    queryKey: ["workflow-samples", ruleId, sampleSearch],
    queryFn: ({ signal }) => workflowGraphApi.samples(ruleId, sampleSearch, signal),
    enabled: mode === "test",
  });

  const test = useMutation({
    mutationFn: async (recordId: string) => {
      if (graph && edits.current > 0) {
        edits.current = 0;
        accept(await workflowGraphApi.saveDraft(ruleId, graph));
        setPending(false);
      }
      return workflowGraphApi.test(ruleId, recordId);
    },
    onSuccess: (result) => setTrace(result),
    onError: (error) => message.error(error instanceof ApiError ? error.message : "The test could not run."),
  });

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

  const palette = useMemo(() => {
    if (!cat) return [];
    const logic = [
      { type: "condition" as const, data: { tree: null }, label: "Condition", description: "Only matching records carry on.", group: "Logic" },
      { type: "branch" as const, data: { tree: null }, label: "If / else", description: "Yes one way, no the other.", group: "Logic" },
    ];
    const actions = cat.canvas_actions.map((item) => ({ type: "action" as const, data: blankData(item.kind), label: item.label, description: item.description, group: "Actions" }));
    const flow = cat.flow.map((item) => ({ type: "action" as const, data: blankData(item.kind), label: item.label, description: item.description, group: "Flow" }));
    return [...logic, ...actions, ...flow];
  }, [cat]);

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

  if (detail.isError) {
    const error = detail.error;
    return <ProblemPage kind={error instanceof ApiError && error.status === 404 ? "not_found" : error instanceof ApiError && error.status === 403 ? "forbidden" : "server"} />;
  }
  if (!data || !cat || !graph) return <Skeleton active paragraph={{ rows: 12 }} />;

  const readOnly = !data.can_edit || mode !== "edit";
  const node = graph.nodes.find((item) => item.id === selected) ?? null;
  const general = problems.filter((item) => !item.node_id);
  const saveState = pending || save.isPending ? "Saving…" : data.draft_updated_at ? `Draft saved ${relativeTime(data.draft_updated_at)}` : "Saved";

  const inspector = node ? (
    <NodeInspector
      node={node}
      graph={graph}
      onChange={change}
      catalogue={cat}
      datasets={datasets}
      problems={byNode[node.id] ?? []}
      summaries={summaries}
      readOnly={readOnly}
      onClose={() => setSelected(null)}
    />
  ) : (
    <WorkflowPanel
      data={data}
      general={general}
      count={problems.length}
      mode={mode}
      trace={trace}
      onRename={(name) => rename.mutate(name)}
      onRestore={(version) => modal.confirm({
        title: `Restore version ${version} into the draft?`,
        content: "Your current draft is replaced. Nothing goes live until you publish.",
        okText: "Restore",
        onOk: () => restore.mutateAsync(version),
      })}
      summaries={summaries}
    />
  );

  return (
    <div className="nx-wf-page">
      <PageHeader
        title={<>Workflow <em>canvas</em></>}
        subtitle={
          <span className="nx-wf-subtitle">
            <span>{data.rule.name}</span>
            <span aria-hidden="true">·</span>
            <span>{data.version ? `Version ${data.version} live` : "Never published"}</span>
            {data.dirty && <Tag color="warning" bordered={false} data-testid="draft-tag">Draft changes</Tag>}
          </span>
        }
        onBack={() => back("/workflows")}
        actions={
          <div className="nx-wf-actions">
            <Tooltip title={data.can_edit ? undefined : "Only its author can change this."}>
              <span className="nx-wf-live">
                <Switch size="small" checked={data.rule.enabled} disabled={!data.can_edit} loading={toggle.isPending}
                  aria-label={data.rule.enabled ? "Pause workflow" : "Turn workflow on"}
                  data-testid="canvas-enabled" onChange={(enabled) => toggle.mutate(enabled)} />
                <span>{data.rule.enabled ? "Live" : "Paused"}</span>
              </span>
            </Tooltip>
            {data.dirty && data.can_edit && (
              <Button onClick={() => discard.mutate()} loading={discard.isPending} data-testid="discard-draft">Discard draft</Button>
            )}
            {data.can_edit && (
              <Button type="primary" onClick={() => publish.mutate()} loading={publish.isPending} data-testid="publish-workflow"
                icon={<NxIcon name="flow" size={16} />}>
                Publish
              </Button>
            )}
          </div>
        }
      />

      <div className={`nx-wf-grid${narrow ? " nx-wf-grid--narrow" : ""}${node && (node.type === "condition" || node.type === "branch") ? " nx-wf-grid--wide-side" : ""}`}>
        {!narrow && (
          <Card size="small" className="nx-wf-palette" data-testid="workflow-palette" title="Steps">
            {(["Logic", "Actions", "Flow"] as const).map((group) => (
              <div key={group} className="nx-wf-palette-group">
                <div className="nx-wf-label">{group}</div>
                {palette.map((item, index) => item.group === group && (
                  <button
                    key={`${item.label}-${index}`}
                    type="button"
                    className="nx-wf-palette-item"
                    draggable={!readOnly}
                    disabled={readOnly}
                    data-testid={`palette-${item.type === "action" ? str(item.data.kind) : item.type}`}
                    onDragStart={(event) => event.dataTransfer.setData(DRAG_TYPE, String(index))}
                    onClick={() => add(index)}
                    title={item.description}
                  >
                    <span className="nx-wf-palette-icon"><NxIcon name={iconFor(item) as NxIconName} size={15} /></span>
                    <span className="nx-wf-palette-text">
                      <span>{item.label}</span>
                      <small>{item.description}</small>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </Card>
        )}

        <Card
          size="small"
          className="nx-wf-stage"
          title={
            <div className="nx-wf-toolbar">
              <Segmented
                aria-label="Canvas mode"
                value={mode}
                onChange={(value) => { setMode(value as Mode); if (value !== "test") setTrace(null); }}
                options={[
                  { value: "edit", label: "Edit" },
                  { value: "test", label: "Test" },
                  { value: "history", label: `History${data.stats.runs ? ` · ${data.stats.runs}` : ""}` },
                ]}
              />
              {narrow && mode === "edit" && data.can_edit && (
                <Dropdown
                  trigger={["click"]}
                  menu={{ items: palette.map((item, index) => ({ key: String(index), label: item.label, onClick: () => add(index) })) }}
                >
                  <Button data-testid="add-step" icon={<NxIcon name="plus" size={14} />}>Add step</Button>
                </Dropdown>
              )}
              {mode === "edit" && (
                <Button onClick={() => canvas.current?.layout()} disabled={readOnly} data-testid="auto-layout">Tidy</Button>
              )}
              <span className="nx-wf-save" aria-live="polite">{mode === "edit" ? saveState : null}</span>
            </div>
          }
          extra={
            problems.length ? (
              <Tag color="error" bordered={false} data-testid="problem-count">{problems.length} to fix</Tag>
            ) : (
              <Tag color="success" bordered={false} data-testid="problem-count">Ready to publish</Tag>
            )
          }
        >
          {mode === "test" && (
            <div className="nx-wf-testbar" data-testid="test-bar">
              <Select
                showSearch
                filterOption={false}
                onSearch={setSampleSearch}
                aria-label="Sample record"
                placeholder="Pick a record to walk through the draft"
                value={sample}
                onChange={setSample}
                loading={samples.isFetching}
                options={(samples.data?.items ?? []).map((item) => ({ value: item.id, label: item.status ? `${item.label} · ${item.status}` : item.label }))}
                className="nx-wf-sample"
              />
              <Button type="primary" disabled={!sample} loading={test.isPending} onClick={() => sample && test.mutate(sample)} data-testid="run-test">
                Run test
              </Button>
              <Text type="secondary" className="nx-wf-hint">Nothing is sent or changed — the actions are switched off.</Text>
            </div>
          )}
          {mode === "history" && !data.stats.runs && (
            <Alert type="info" showIcon className="nx-wf-testbar" message="No runs yet — publish it, turn it on, and the counts appear here." />
          )}
          <WorkflowCanvas
            ref={canvas}
            graph={graph}
            onChange={change}
            selected={selected}
            onSelect={setSelected}
            summaries={summaries}
            problems={mode === "edit" ? byNode : {}}
            overlay={overlay}
            readOnly={readOnly}
            onDropItem={(payload, position) => add(Number(payload), position)}
            onMessage={(text) => message.warning(text)}
          />
        </Card>

        {narrow ? (
          <Drawer
            open={Boolean(node)}
            onClose={() => setSelected(null)}
            placement="bottom"
            height="72vh"
            title={null}
            closable={false}
            className="nx-wf-drawer"
          >
            {node && inspector}
          </Drawer>
        ) : (
          <Card size="small" className="nx-wf-side">{inspector}</Card>
        )}
      </div>
      {narrow && !node && <Card size="small" className="nx-wf-side nx-wf-side--below">{inspector}</Card>}
    </div>
  );
}

function WorkflowPanel({ data, general, count, mode, trace, onRename, onRestore, summaries }: {
  data: GraphDetail;
  general: GraphProblem[];
  count: number;
  mode: Mode;
  trace: TraceResult | null;
  onRename: (name: string) => void;
  onRestore: (version: number) => void;
  summaries: Record<string, { title: string; detail: string }>;
}) {
  return (
    <div className="nx-wf-inspector" data-testid="workflow-panel">
      <div className="nx-wf-field">
        <span className="nx-wf-label">Name</span>
        {data.can_edit ? (
          <Input aria-label="Workflow name" defaultValue={data.rule.name} key={data.rule.name}
            onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== data.rule.name) onRename(value); }} />
        ) : <Text strong>{data.rule.name}</Text>}
      </div>

      {mode === "test" && trace && (
        <div className="nx-wf-trace" data-testid="trace-result">
          <span className="nx-wf-label">Path for {trace.record.label}</span>
          {trace.error && <Alert type="error" showIcon message={trace.error} />}
          <ol>
            {trace.nodes.map((step, index) => (
              <li key={`${step.node_id}-${index}`} className={`nx-wf-trace-step nx-wf-trace-step--${TRACE_TONE[step.state] ?? "acc"}`}>
                <strong>{summaries[step.node_id]?.title ?? step.node_id}</strong>
                <span>{step.state}{step.detail ? ` — ${step.detail}` : ""}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {count > 0 ? (
        <Alert type="warning" showIcon data-testid="graph-problems"
          message={`${count} thing${count === 1 ? "" : "s"} to fix before publishing`}
          description={general.length ? <ul>{general.map((item) => <li key={item.message}>{item.message}</li>)}</ul> : "Steps ringed in red say what they need — select one."} />
      ) : (
        <Text type="secondary" className="nx-wf-hint">Select a step to edit it. Drag from a step's lower edge to connect it to the next one.</Text>
      )}

      {data.webhook_path && (
        <div className="nx-wf-field">
          <span className="nx-wf-label">Webhook address</span>
          <Typography.Text code copyable className="nx-wf-code">{`${window.location.origin}/platform${data.webhook_path}`}</Typography.Text>
        </div>
      )}

      <div className="nx-wf-field">
        <span className="nx-wf-label">Versions</span>
        {data.versions.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Not published yet" /> : (
          <ul className="nx-wf-versions" data-testid="versions">
            {data.versions.map((version) => (
              <li key={version.version}>
                <span className="nx-wf-version-no">v{version.version}</span>
                <span className="nx-wf-version-text">
                  <span>{version.note || "Published"}{version.version === data.version ? " · live" : ""}</span>
                  <small>{version.by ?? "Somebody"} · {version.published_at ? relativeTime(version.published_at) : ""}</small>
                </span>
                {data.can_edit && version.version !== data.version && (
                  <Button size="small" type="text" onClick={() => onRestore(version.version)} data-testid={`restore-${version.version}`}>Restore</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
