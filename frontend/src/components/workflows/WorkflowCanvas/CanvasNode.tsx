import { Tooltip } from "antd";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { GraphNode } from "@/api/workflowGraph";
import { NxIcon, type NxIconName } from "@/components/NxIcon";

import { NODE_H, NODE_W, PORT_LABEL, iconFor, portOffset, portsOf } from "../graph";
import type { CanvasOverlay } from "./types";

interface CanvasNodeProps {
  node: GraphNode;
  summary: { title: string; detail: string };
  issues: string[];
  selected: boolean;
  overlay?: CanvasOverlay | null;
  onSelect: (id: string) => void;
  onNodeDown: (event: ReactPointerEvent, node: GraphNode) => void;
  onPortDown: (event: ReactPointerEvent, node: GraphNode, port: string) => void;
}

const KIND_WORD: Record<string, string> = { trigger: "When", action: "Then" };

/** One step on the canvas: its icon, title and detail, problems, badges, and output ports. */
export function CanvasNode({ node, summary, issues, selected, overlay, onSelect, onNodeDown, onPortDown }: CanvasNodeProps) {
  const path = overlay?.path;
  const dim = path && !path.nodes.has(node.id);
  const badges = overlay?.badges[node.id] ?? [];
  return (
    <div
      key={node.id}
      data-node-id={node.id}
      data-testid={`node-${node.id}`}
      className={[
        "nx-wf-node", `nx-wf-node--${node.type}`,
        selected ? "is-selected" : "",
        issues.length ? "has-problem" : "",
        dim ? "is-dim" : "",
        path?.nodes.has(node.id) ? "is-hot" : "",
      ].join(" ")}
      style={{ left: node.position.x, top: node.position.y, width: NODE_W, height: NODE_H }}
      onPointerDown={(event) => onNodeDown(event, node)}
      role="button"
      tabIndex={0}
      aria-label={`${summary.title}${summary.detail ? `: ${summary.detail}` : ""}${issues.length ? ` — ${issues.length} problem${issues.length === 1 ? "" : "s"}` : ""}`}
      aria-pressed={selected}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.id); }
      }}
    >
      {node.type !== "trigger" && <span className="nx-wf-port nx-wf-port--in" aria-hidden="true" />}
      <span className="nx-wf-node-icon" aria-hidden="true"><NxIcon name={iconFor(node) as NxIconName} size={16} /></span>
      <span className="nx-wf-node-text">
        <span className="nx-wf-node-kind">{KIND_WORD[node.type] ?? "If"}</span>
        <span className="nx-wf-node-title">{summary.title}</span>
        <span className="nx-wf-node-detail">{summary.detail}</span>
      </span>
      {issues.length > 0 && (
        <Tooltip title={issues.join(" ")}>
          <span className="nx-wf-node-problem" data-testid={`problem-${node.id}`} role="img" aria-label={issues.join(" ")}>!</span>
        </Tooltip>
      )}
      {badges.length > 0 && (
        <span className="nx-wf-badges">
          {badges.map((badge) => (
            <span key={badge.label} className={`nx-wf-badge nx-wf-badge--${badge.tone}`}>{badge.label}</span>
          ))}
        </span>
      )}
      {portsOf(node).map((port) => {
        const offset = portOffset(node, port);
        return (
          <span
            key={port}
            className={`nx-wf-port nx-wf-port--out nx-wf-port--${port}`}
            style={{ left: offset.x }}
            data-testid={`port-${node.id}-${port}`}
            title={PORT_LABEL[port] || "Drag to connect"}
            onPointerDown={(event) => onPortDown(event, node, port)}
          />
        );
      })}
    </div>
  );
}
