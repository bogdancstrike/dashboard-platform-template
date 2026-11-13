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

import { Alert, App as AntApp, Card, Drawer, Skeleton, Tag } from "antd";

import { ApiError } from "@/api/client";
import type { GraphNode } from "@/api/workflowGraph";
import { useSmartBack } from "@/app/history";
import { PageHeader } from "@/components/PageHeader";
import { ProblemPage } from "@/components/ProblemPage";
import { NodeInspector } from "@/components/workflows/NodeInspector";
import { WorkflowCanvas } from "@/components/workflows/WorkflowCanvas";
import { relativeTime } from "@/lib/time";
import "@/styles/workflows.css";

import { CanvasActions } from "./CanvasActions";
import { StageToolbar, TestBar } from "./StageBars";
import { StepPalette } from "./StepPalette";
import { WorkflowPanel } from "./WorkflowPanel";
import { useWorkflowCanvasPage } from "./useWorkflowCanvasPage";

export { historyOverlay, problemsByNode, traceOverlay, withCanvas } from "./canvasOverlays";

export default function WorkflowCanvasPage() {
  const back = useSmartBack();
  const page = useWorkflowCanvasPage();
  const { draft, selected, setSelected, mode, narrow, data, cat, palette, add } = page;
  const { graph, pending, detail, save } = draft;

  if (detail.isError) {
    const error = detail.error;
    return <ProblemPage kind={problemKind(error)} />;
  }
  if (!data || !cat || !graph) return <Skeleton active paragraph={{ rows: 12 }} />;

  const readOnly = !data.can_edit || mode !== "edit";
  const node = graph.nodes.find((item) => item.id === selected) ?? null;
  const saveState = pending || save.isPending ? "Saving…" : savedLabel(data.draft_updated_at);

  const inspector = <SidePanel page={page} node={node} readOnly={readOnly} />;

  return (
    <div className="nx-wf-page">
      <CanvasHeader page={page} onBack={() => back("/workflows")} />

      <div className={gridClass(narrow, node)}>
        {!narrow && <StepPalette palette={palette} readOnly={readOnly} onAdd={(index) => add(index)} />}

        <Stage page={page} readOnly={readOnly} saveState={saveState} />

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

/** The page a failed load becomes: missing, refused, or broken. */
function problemKind(error: unknown): "not_found" | "forbidden" | "server" {
  if (error instanceof ApiError && error.status === 404) return "not_found";
  if (error instanceof ApiError && error.status === 403) return "forbidden";
  return "server";
}

function savedLabel(at: string | null | undefined): string {
  return at ? `Draft saved ${relativeTime(at)}` : "Saved";
}

/** The selected step's inspector, or — with nothing selected — the workflow's own panel. */
function SidePanel({ page, node, readOnly }: { page: ReturnType<typeof useWorkflowCanvasPage>; node: GraphNode | null; readOnly: boolean }) {
  const { modal } = AntApp.useApp();
  const { setSelected, mode, cat, datasets, summaries, byNode, rename } = page;
  const { graph, problems, trace, change, restore } = page.draft;
  const data = page.data!;
  if (node) {
    return (
      <NodeInspector
        node={node}
        graph={graph!}
        onChange={change}
        catalogue={cat!}
        datasets={datasets}
        problems={byNode[node.id] ?? []}
        summaries={summaries}
        readOnly={readOnly}
        onClose={() => setSelected(null)}
      />
    );
  }
  return (
    <WorkflowPanel
      data={data}
      general={problems.filter((item) => !item.node_id)}
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
}

/** The grid: narrow puts the inspector in a drawer; a condition's rule builder wants a wider side. */
function gridClass(narrow: boolean, node: GraphNode | null): string {
  const wide = node && (node.type === "condition" || node.type === "branch");
  return `nx-wf-grid${narrow ? " nx-wf-grid--narrow" : ""}${wide ? " nx-wf-grid--wide-side" : ""}`;
}

function CanvasHeader({ page, onBack }: { page: ReturnType<typeof useWorkflowCanvasPage>; onBack: () => void }) {
  const data = page.data!;
  const back = onBack;
  return (
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
      onBack={back}
      actions={<CanvasActions page={page} />}
    />

  );
}

/** The canvas in its card: mode, tidy and save state above, test bar or history note, then the graph. */
function Stage({ page, readOnly, saveState }: { page: ReturnType<typeof useWorkflowCanvasPage>; readOnly: boolean; saveState: string }) {
  const { message } = AntApp.useApp();
  const { canvas, selected, setSelected, mode, summaries, byNode, overlay, add } = page;
  const { problems, change } = page.draft;
  const graph = page.draft.graph!;
  const data = page.data!;
  return (
    <Card
      size="small"
      className="nx-wf-stage"
      title={<StageToolbar page={page} readOnly={readOnly} saveState={saveState} />}
      extra={
        problems.length ? (
          <Tag color="error" bordered={false} data-testid="problem-count">{problems.length} to fix</Tag>
        ) : (
          <Tag color="success" bordered={false} data-testid="problem-count">Ready to publish</Tag>
        )
      }
    >
      {mode === "test" && <TestBar page={page} />}
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
  );
}
