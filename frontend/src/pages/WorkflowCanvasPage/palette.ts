import { blankData } from "@/components/workflows/graph";

import type { Catalogue } from "./canvasOverlays";

/** The steps the palette offers: the two logic steps, then the catalogue's actions and flow steps. */
export function buildPalette(cat: Catalogue | undefined) {
  if (!cat) return [];
  const logic = [
    { type: "condition" as const, data: { tree: null }, label: "Condition", description: "Only matching records carry on.", group: "Logic" },
    { type: "branch" as const, data: { tree: null }, label: "If / else", description: "Yes one way, no the other.", group: "Logic" },
  ];
  const actions = cat.canvas_actions.map((item) => ({ type: "action" as const, data: blankData(item.kind), label: item.label, description: item.description, group: "Actions" }));
  const flow = cat.flow.map((item) => ({ type: "action" as const, data: blankData(item.kind), label: item.label, description: item.description, group: "Flow" }));
  return [...logic, ...actions, ...flow];
}

export type PaletteItem = ReturnType<typeof buildPalette>[number];
