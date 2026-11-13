import { Alert, Button, Input, Typography } from "antd";

import type { GraphDetail, GraphProblem, TraceResult } from "@/api/workflowGraph";
import { EmptyState } from "@/components/EmptyState";
import { relativeTime } from "@/lib/time";

import { TRACE_TONE, type Mode } from "./canvasOverlays";

const { Text } = Typography;

/** With no step selected: the workflow's name, a test's path, what to fix, its webhook and its versions. */
export function WorkflowPanel({ data, general, count, mode, trace, onRename, onRestore, summaries }: {
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

      <VersionList data={data} onRestore={onRestore} />
    </div>
  );
}

/** Every published version; any but the live one can be restored into the draft. */
function VersionList({ data, onRestore }: { data: GraphDetail; onRestore: (version: number) => void }) {
  return (
    <div className="nx-wf-field">
      <span className="nx-wf-label">Versions</span>
      {data.versions.length === 0 ? <EmptyState compact title="Not published yet" /> : (
        <ul className="nx-wf-versions" data-testid="versions">
          {data.versions.map((version) => (
            <li key={version.version}>
              <span className="nx-wf-version-no">v{version.version}</span>
              <span className="nx-wf-version-text">
                <span>{version.note || "Published"}{version.version === data.version ? " · live" : ""}</span>
                <small>{version.by ?? "Somebody"} · {version.published_at ? relativeTime(version.published_at) : ""}</small>
              </span>
              {data.can_edit && version.version !== data.version && (
                <Button type="text" onClick={() => onRestore(version.version)} data-testid={`restore-${version.version}`}>Restore</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
