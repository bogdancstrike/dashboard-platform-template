/**
 * The selected step, edited (§49).
 *
 * One panel for every kind of node, because what changes between them is the
 * fields, not the frame. Conditions reuse the advanced search's own builder —
 * the same fields, operators and compiled SQL — so a branch on the canvas and a
 * saved search can never disagree about what "priority is high" means.
 *
 * It also carries **Next step**, one picker per output: everything the canvas
 * does by dragging a wire is possible here without a pointer.
 */

import { Alert, Button, Typography } from "antd";
import { DeleteOutlined } from "@ant-design/icons";

import type { ExplorerResource } from "@/api/explorer";
import type { GraphNode, WorkflowGraph } from "@/api/workflowGraph";
import { AdvancedQueryBuilder } from "@/components/explorer/AdvancedQueryBuilder";
import { emptyTree, type QueryNode } from "@/components/explorer/queryTree";

import { removeNode, str, updateData } from "../graph";
import { ActionFields } from "./actionEditors";
import { Field } from "./Field";
import { NextSteps } from "./NextSteps";
import { TriggerFields } from "./TriggerFields";
import type { Catalogue } from "./types";

const { Text } = Typography;

const KIND_LABEL: Record<string, string> = { trigger: "Trigger", action: "Action", branch: "Branch" };

interface NodeInspectorProps {
  node: GraphNode;
  graph: WorkflowGraph;
  onChange: (graph: WorkflowGraph) => void;
  catalogue: Catalogue;
  datasets: ExplorerResource[];
  problems: string[];
  summaries: Record<string, { title: string }>;
  readOnly?: boolean;
  onClose?: () => void;
}

export function NodeInspector({ node, graph, onChange, catalogue, datasets, problems, summaries, readOnly, onClose }: NodeInspectorProps) {
  const data = node.data;
  const set = (changes: Record<string, unknown>) => onChange(updateData(graph, node.id, { ...data, ...changes }));
  const trigger = graph.nodes.find((item) => item.type === "trigger");
  const datasetKey = (str(trigger?.data.resource_type) || "task");
  const dataset = datasets.find((item) => item.key === datasetKey);
  const kind = str(data.kind);
  const editor = { data, set, catalogue, dataset, datasets };

  return (
    <div className="nx-wf-inspector" data-testid="node-inspector">
      <div className="nx-wf-inspector-head">
        <div>
          <div className="nx-wf-inspector-kind">{KIND_LABEL[node.type] ?? "Condition"}</div>
          <div className="nx-wf-inspector-title">{summaries[node.id]?.title ?? node.id}</div>
        </div>
        {onClose && <Button type="text" onClick={onClose} aria-label="Close step">Done</Button>}
      </div>

      {problems.length > 0 && (
        <Alert type="error" showIcon className="nx-wf-inspector-alert" data-testid="inspector-problems"
          message={problems.length === 1 ? problems[0] : `${problems.length} things to fix`}
          description={problems.length > 1 ? <ul>{problems.map((item) => <li key={item}>{item}</li>)}</ul> : undefined} />
      )}

      <fieldset disabled={readOnly} className="nx-wf-fields">
        {node.type === "trigger" && <TriggerFields {...editor} />}
        {(node.type === "condition" || node.type === "branch") && <RuleFields node={node} {...editor} />}
        {node.type === "action" && <ActionFields kind={kind} {...editor} />}
      </fieldset>

      <NextSteps node={node} graph={graph} onChange={onChange} summaries={summaries} readOnly={readOnly} />

      {node.type !== "trigger" && !readOnly && (
        <Button danger icon={<DeleteOutlined />} className="nx-wf-remove" data-testid="remove-node"
          onClick={() => { onChange(removeNode(graph, node.id)); onClose?.(); }}>
          Remove this step
        </Button>
      )}
    </div>
  );
}

/**
 * Conditions reuse the advanced search's own builder — the same fields,
 * operators and compiled SQL — so a branch and a saved search agree.
 */
function RuleFields({ node, data, set, dataset }: { node: GraphNode; data: Record<string, unknown>; set: (changes: Record<string, unknown>) => void; dataset?: ExplorerResource }) {
  return (
    <Field label="Rules">
      <Text type="secondary" className="nx-wf-hint">
        {node.type === "branch" ? "Records that match go down Yes; the rest go down No." : "Only records that match carry on."}
      </Text>
      {dataset ? (
        <AdvancedQueryBuilder
          fields={dataset.fields}
          value={(data.tree as QueryNode | undefined) ?? emptyTree()}
          onChange={(tree) => set({ tree })}
        />
      ) : (
        <Text type="secondary">Choose the trigger's dataset first.</Text>
      )}
    </Field>
  );
}
