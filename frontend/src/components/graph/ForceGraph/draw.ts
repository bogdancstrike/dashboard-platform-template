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
} from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, type D3ZoomEvent } from "d3-zoom";

import type { GraphLink, GraphNode, Link, Placed } from "./types";

const LINK_DISTANCE = 46;

/**
 * Draw the graph into the SVG and start the simulation that lays it out:
 * links, nodes with their labels, keyboard and pointer handlers, dragging,
 * and zoom. Returns the running simulation so the caller can stop it.
 */
export function drawGraph(
  svg: SVGSVGElement,
  {
    width,
    height,
    nodes,
    links: given,
    charge,
    onSelect,
    onOpen,
  }: {
    width: number;
    height: number;
    nodes: GraphNode[];
    links: GraphLink[];
    charge: number;
    onSelect?: (key: string | null) => void;
    onOpen?: (key: string) => void;
  },
): Simulation<Placed, Link> {
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
  return engine;
}
