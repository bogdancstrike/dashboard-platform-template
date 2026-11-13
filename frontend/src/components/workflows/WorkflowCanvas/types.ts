import type { WorkflowGraph } from "@/api/workflowGraph";

export interface CanvasOverlay {
  /** Per-node badges: counts from run history, or a test run's states. */
  badges: Record<string, Array<{ label: string; tone: "ok" | "warn" | "bad" | "acc" }>>;
  /** Steps and connections to emphasise; everything else is dimmed. */
  path?: { nodes: Set<string>; edges: Set<string> };
  /** Counts drawn on connections. */
  edgeCounts?: Record<string, number>;
}

export interface CanvasHandle {
  fit: () => void;
  layout: () => void;
  /** The graph point at the centre of the view, for steps added by a click. */
  centre: () => { x: number; y: number };
}

export interface CanvasProps {
  graph: WorkflowGraph;
  onChange: (graph: WorkflowGraph) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  summaries: Record<string, { title: string; detail: string }>;
  problems: Record<string, string[]>;
  overlay?: CanvasOverlay | null;
  readOnly?: boolean;
  /** A palette item dropped on the canvas, at a graph position. */
  onDropItem?: (payload: string, position: { x: number; y: number }) => void;
  onMessage?: (text: string) => void;
}

export type Gesture =
  | { kind: "pan"; startX: number; startY: number; viewX: number; viewY: number }
  | { kind: "move"; id: string; startX: number; startY: number; nodeX: number; nodeY: number; moved: boolean }
  | { kind: "wire"; source: string; port: string; x: number; y: number };

export const DRAG_TYPE = "application/x-nucleus-step";

export interface View {
  x: number;
  y: number;
  zoom: number;
}
