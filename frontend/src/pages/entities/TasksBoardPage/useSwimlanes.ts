import { humanStatus } from "@/components/StatusTag";
import { laneKey, parseLane, swimlaneOrder, swimOf, type Swimlane } from "@/components/planning/BoardExtras";

import type { TaskRow } from "./types";

export function useSwimlanes(
  swim: Swimlane,
  laneRows: TaskRow[][],
  laneIds: string[],
  epicName: Map<string, string>,
  people: Map<string, { name: string }> | undefined,
) {
  /**
   * Swimlanes (§18): each status lane is split by assignee, priority or epic.
   * A drag lane is then `swimlane|status`, and a drop into another swimlane
   * also writes the field the swimlanes are drawn by.
   */
  const swimLabel = (key: string) =>
    swim === "assignee"
      ? key ? people?.get(key)?.name ?? "Someone" : "Unassigned"
      : swim === "epic"
        ? key ? epicName.get(key) ?? "An epic" : "No epic"
        : swim === "priority"
          ? humanStatus(key || "NORMAL")
          : "";
  const swimKeys = swimlaneOrder(
    laneRows.flat().map((task) => swimOf(task as Record<string, unknown>, swim)),
    swim,
    swimLabel,
  );
  if (swimKeys.length === 0) swimKeys.push(swim === "none" ? "all" : "");
  // Without swimlanes a drag lane is just its status, as it always was.
  const keyFor = (swimKey: string, status: string) => (swim === "none" ? status : laneKey(swimKey, status));
  const dragLanes = swimKeys.flatMap((key) => laneIds.map((status) => keyFor(key, status)));
  const rowsIn = (lane: string) => {
    const { swim: key, status } = parseLane(lane);
    return (laneRows[laneIds.indexOf(status)] ?? []).filter(
      (task) => swim === "none" || swimOf(task as Record<string, unknown>, swim) === key,
    );
  };

  /** The neighbours a card would have at `index` of `lane`, counted without it. */
  const neighbours = (lane: string, index: number, id: string) => {
    const rows = rowsIn(lane).filter((row) => row.id !== id);
    return { afterId: rows[index - 1]?.id ?? null, beforeId: rows[index]?.id ?? null };
  };

  return { swimLabel, swimKeys, keyFor, dragLanes, rowsIn, neighbours };
}
