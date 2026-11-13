import { Select, Typography } from "antd";

import type { GraphNode, WorkflowGraph } from "@/api/workflowGraph";

import { PORT_LABEL, connect, connectionProblem, disconnect, portsOf } from "../graph";

const { Text } = Typography;

interface NextStepsProps {
  node: GraphNode;
  graph: WorkflowGraph;
  onChange: (graph: WorkflowGraph) => void;
  summaries: Record<string, { title: string }>;
  readOnly?: boolean;
}

/** One picker per output: everything the canvas does by dragging a wire, without a pointer. */
export function NextSteps({ node, graph, onChange, summaries, readOnly }: NextStepsProps) {
  return (
    <div className="nx-wf-next">
      <Text strong className="nx-wf-label">Next step</Text>
      {portsOf(node).map((port) => {
        const current = graph.edges.find((edge) => edge.source === node.id && edge.port === port);
        return (
          <div key={port} className="nx-wf-next-row">
            {PORT_LABEL[port] && <span className={`nx-wf-port-chip nx-wf-port-chip--${port}`}>{PORT_LABEL[port]}</span>}
            <Select
              aria-label={`Next step${PORT_LABEL[port] ? ` when ${PORT_LABEL[port]}` : ""}`}
              data-testid={`next-${port}`}
              allowClear
              disabled={readOnly}
              placeholder="Nothing — the workflow ends here"
              value={current?.target}
              onChange={(target?: string) => {
                if (!target) {
                  if (current) onChange(disconnect(graph, current.id));
                  return;
                }
                if (!connectionProblem(graph, node.id, port, target)) onChange(connect(graph, node.id, port, target));
              }}
              options={graph.nodes
                .filter((item) => item.id !== node.id && item.type !== "trigger")
                .map((item) => ({
                  value: item.id,
                  label: summaries[item.id]?.title ?? item.id,
                  disabled: item.id !== current?.target && Boolean(connectionProblem(graph, node.id, port, item.id)),
                }))}
            />
          </div>
        );
      })}
    </div>
  );
}
