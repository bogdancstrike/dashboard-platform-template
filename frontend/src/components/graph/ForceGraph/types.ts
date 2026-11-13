import { type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";

/**
 * What this component draws. Deliberately *not* the shape of any one endpoint:
 * three different graphs on this page feed it — the record network, the map of
 * entity types, and one record's neighbours — and a component that knew about
 * all three would be three components sharing a file.
 */
export interface GraphNode {
  key: string;
  label: string;
  /** Radius in pixels, already decided by the caller. */
  size: number;
  color: string;
  /** The cluster this belongs to; dimming works on it. */
  group?: string;
  /** Drawn with a heavier outline — the records a picture is built around. */
  ring?: boolean;
  /** Shown on hover and read out to a screen reader. */
  title?: string;
  /** Labelled on the canvas. Everything else relies on hover and the panel. */
  labelled?: boolean;
  /** Double-click opens it; nodes without a page are select-only. */
  openable?: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
  label?: string;
  /** Stroke width in pixels. */
  weight?: number;
  /** Crosses between clusters — drawn dashed, because it is the finding. */
  dashed?: boolean;
}

export interface Placed extends SimulationNodeDatum, GraphNode {}

export type Link = SimulationLinkDatum<Placed> & { label: string; dashed: boolean; weight: number };

export interface ForceGraphProps {
  nodes: GraphNode[];
  links: GraphLink[];
  /** The cluster being inspected; everything else is dimmed. */
  highlighted?: string | null;
  /**
   * Specific nodes to spotlight, when the thing being inspected is not a
   * cluster — the two ends of one relation, say. Takes precedence over
   * `highlighted`; both dim rather than hide, because a picture that removes
   * what you did not select stops being a picture of the whole.
   */
  spotlight?: string[] | null;
  height?: number;
  /** Pulls nodes apart. Lower for dense graphs, higher for sparse ones. */
  charge?: number;
  onSelect?: (key: string | null) => void;
  onOpen?: (key: string) => void;
  /** Describes the whole picture for a reader who cannot see it (§55). */
  description: string;
}
