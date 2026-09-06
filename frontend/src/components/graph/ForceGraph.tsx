/**
 * A force-directed graph, drawn with D3 (§50).
 *
 * D3 rather than ECharts here for one reason: this picture has to be
 * *interrogated*, not looked at. Zooming into a cluster, dragging a node out
 * of a knot to see what it holds, and dimming everything that is not a
 * neighbour are the actions that turn a hairball into an answer, and they need
 * direct control of the simulation and of the SVG. `d3-force` is the layout,
 * `d3-zoom` the camera and `d3-drag` the hands; React owns the container and
 * nothing inside it, which is the only division of labour between the two that
 * does not fight.
 *
 * What the picture encodes, and nothing else:
 *
 * * **colour** — the community the server detected. Not the entity type: the
 *   clustering is the finding, and a picture that colours by table shows only
 *   what the reader already knew.
 * * **size** — how many distinct neighbours a record has.
 * * **ring** — the records the network was built around.
 * * **dashed edge** — a link that crosses between communities. Usually the
 *   interesting one: the shared account manager, the project two departments
 *   both work on.
 *
 * The layout is seeded deterministically and the simulation is stopped once it
 * settles, so reopening the page gives the same arrangement rather than a new
 * one to re-learn. With `prefers-reduced-motion` it is solved to convergence
 * before the first paint and never animates at all.
 */

import { drag as d3drag, type D3DragEvent } from "d3-drag";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, type D3ZoomEvent } from "d3-zoom";
import { useEffect, useRef } from "react";

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

interface Placed extends SimulationNodeDatum, GraphNode {}
type Link = SimulationLinkDatum<Placed> & { label: string; dashed: boolean; weight: number };

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

const LINK_DISTANCE = 46;

export function ForceGraph({
  nodes,
  links: given,
  highlighted = null,
  spotlight = null,
  height = 520,
  charge = -180,
  onSelect,
  onOpen,
  description,
}: ForceGraphProps) {
  const host = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulation = useRef<Simulation<Placed, Link> | null>(null);

  // The picture is rebuilt when the data changes, and only then. Highlighting
  // is applied separately below, because re-running a simulation to dim half
  // of it would throw away the arrangement the reader is looking at.
  useEffect(() => {
    const svg = svgRef.current;
    const container = host.current;
    if (!svg || !container) return;

    const width = Math.max(container.clientWidth, 320);
    const placed: Placed[] = nodes.map((node, index) => ({
      ...node,
      // Seeded on a spiral rather than left to D3's own placement, so the
      // same graph settles the same way twice.
      x: width / 2 + Math.cos(index * 2.399) * (8 + index * 1.6),
      y: height / 2 + Math.sin(index * 2.399) * (8 + index * 1.6),
    }));
    const byKey = new Map(placed.map((node) => [node.key, node]));
    const links: Link[] = given
      .filter((link) => byKey.has(link.source) && byKey.has(link.target))
      .map((link) => ({
        source: byKey.get(link.source)!,
        target: byKey.get(link.target)!,
        label: link.label ?? "",
        dashed: Boolean(link.dashed),
        weight: link.weight ?? 1,
      }));

    const root = select(svg);
    root.selectAll("*").remove();
    root.attr("viewBox", `0 0 ${width} ${height}`);

    const camera = root.append("g").attr("class", "nu-force-camera");
    const linkLayer = camera.append("g").attr("class", "nu-force-links");
    const nodeLayer = camera.append("g").attr("class", "nu-force-nodes");

    const line = linkLayer
      .selectAll<SVGLineElement, Link>("line")
      .data(links)
      .join("line")
      .attr("class", (link) => (link.dashed ? "nu-force-link nu-force-bridge" : "nu-force-link"))
      .attr("stroke-width", (link) => link.weight);
    line.append("title").text((link) => link.label);

    const radius = (node: Placed) => node.size;

    const group = nodeLayer
      .selectAll<SVGGElement, Placed>("g")
      .data(placed, (node) => node.key)
      .join("g")
      .attr("class", "nu-force-node")
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (node) => node.title ?? node.label);

    group
      .append("circle")
      .attr("r", radius)
      .attr("fill", (node) => node.color)
      .attr("stroke-width", (node) => (node.ring ? 2.5 : 1));

    group
      .append("text")
      .attr("class", "nu-force-label")
      .attr("dy", (node) => -radius(node) - 4)
      .attr("text-anchor", "middle")
      .text((node) => (node.labelled ? node.label : ""));

    group.append("title").text((node) => node.title ?? node.label);

    group
      .on("click", (_event, node) => onSelect?.(node.key))
      .on("dblclick", (event: MouseEvent, node) => {
        event.stopPropagation();
        if (node.openable) onOpen?.(node.key);
      })
      .on("keydown", (event: KeyboardEvent, node) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(node.key);
        }
      });

    const engine = forceSimulation<Placed, Link>(placed)
      .force("link", forceLink<Placed, Link>(links).id((node) => node.key).distance(LINK_DISTANCE).strength(0.35))
      .force("charge", forceManyBody<Placed>().strength(charge).distanceMax(520))
      .force("collide", forceCollide<Placed>((node) => radius(node) + 5))
      .force("centre", forceCenter(width / 2, height / 2))
      // Gentle pull towards the middle, or a detached cluster drifts off the
      // canvas and the reader has to hunt for it with the zoom.
      .force("x", forceX(width / 2).strength(0.03))
      .force("y", forceY(height / 2).strength(0.03));

    const paint = () => {
      line
        .attr("x1", (link) => (link.source as Placed).x ?? 0)
        .attr("y1", (link) => (link.source as Placed).y ?? 0)
        .attr("x2", (link) => (link.target as Placed).x ?? 0)
        .attr("y2", (link) => (link.target as Placed).y ?? 0);
      group.attr("transform", (node) => `translate(${node.x ?? 0},${node.y ?? 0})`);
    };

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      // Solve it before the first paint. Somebody who has asked the platform
      // to stop moving has not asked for a slower version of the movement.
      engine.stop();
      for (let step = 0; step < 320; step += 1) engine.tick();
      paint();
    } else {
      engine.on("tick", paint);
    }
    simulation.current = engine;

    type Dragging = D3DragEvent<SVGGElement, Placed, Placed>;
    group.call(
      d3drag<SVGGElement, Placed>()
        .on("start", (event: Dragging, node) => {
          if (!event.active) engine.alphaTarget(0.15).restart();
          node.fx = node.x;
          node.fy = node.y;
        })
        .on("drag", (event: Dragging, node) => {
          node.fx = event.x;
          node.fy = event.y;
        })
        .on("end", (event: Dragging, node) => {
          if (!event.active) engine.alphaTarget(0);
          // Released rather than pinned: a node left where it was dropped
          // quietly turns the layout into a hand-drawn one nobody can redraw.
          node.fx = null;
          node.fy = null;
        }),
    );

    root.call(
      d3zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.35, 6])
        .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
          camera.attr("transform", event.transform.toString());
        }),
    );
    // Double-click is "follow this record", so it must not also zoom.
    root.on("dblclick.zoom", null);
    root.on("click", (event: MouseEvent) => {
      if (event.target === svg) onSelect?.(null);
    });

    return () => {
      engine.stop();
      simulation.current = null;
    };
  }, [nodes, given, height, charge, onSelect, onOpen]);

  // Dimming is a class on existing elements, not a redraw: the arrangement
  // the reader is reading has to survive them clicking a cluster.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const lit = spotlight && spotlight.length > 0 ? new Set(spotlight) : null;
    const dimNode = (node: Placed) =>
      lit ? !lit.has(node.key) : Boolean(highlighted) && node.group !== highlighted;
    const root = select(svg);
    root.selectAll<SVGGElement, Placed>("g.nu-force-node").classed("nu-dimmed", dimNode);
    root
      .selectAll<SVGLineElement, Link>("line")
      .classed(
        "nu-dimmed",
        (link) => dimNode(link.source as Placed) && dimNode(link.target as Placed),
      );
  }, [highlighted, spotlight, nodes, given]);

  return (
    <div ref={host} className="nu-force" data-testid="force-graph">
      <svg
        ref={svgRef}
        role="img"
        aria-label={description}
        height={height}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
      />
    </div>
  );
}
