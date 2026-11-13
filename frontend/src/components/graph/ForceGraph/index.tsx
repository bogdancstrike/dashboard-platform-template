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

import { type Simulation } from "d3-force";
import { select } from "d3-selection";
import { useEffect, useRef } from "react";

import type { ForceGraphProps, Link, Placed } from "./types";

import { drawGraph } from "./draw";

export type { ForceGraphProps, GraphLink, GraphNode } from "./types";

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
    const engine = drawGraph(svg, { width, height, nodes, links: given, charge, onSelect, onOpen });
    simulation.current = engine;

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
        // A group rather than an image: every node inside is a `role="button"`
        // a keyboard can reach, and `role="img"` promises a picture with
        // nothing in it — `nested-interactive`, and a screen reader that
        // announces the summary and then hides the graph it summarises. The
        // name still reads the whole summary aloud (§55).
        role="group"
        aria-label={description}
        height={height}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
      />
    </div>
  );
}
