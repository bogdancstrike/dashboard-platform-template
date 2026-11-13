import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { planningApi } from "@/api/planning";
import { useBoardDrag, type DropTarget } from "@/components/kanban/useBoardDrag";
import { parseLane, SWIMLANE_FIELD, usePeopleNames, type Swimlane } from "@/components/planning/BoardExtras";
import type { EntityView } from "@/entities/useEntityView";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { PER_LANE, PER_LANE_SWIMMING } from "./types";
import { laneName, useMoveTask } from "./useMoveTask";
import { useSwimlanes } from "./useSwimlanes";
import { useTaskLanes } from "./useTaskLanes";

/**
 * Everything the board knows: its lanes and their queries, the swimlanes they
 * are split into, the move that writes a drop, and the drag that makes one.
 * The page draws it; this decides it.
 */
export function useTasksBoard(view: EntityView, canEdit: boolean) {
  const { filters, term } = view;
  const swim = (["assignee", "priority", "epic"].includes(view.params.get("swim") ?? "")
    ? view.params.get("swim")
    : "none") as Swimlane;
  const perLane = swim === "none" ? PER_LANE : PER_LANE_SWIMMING;
  const epics = useQuery({ queryKey: queryKeys.epics(""), queryFn: ({ signal }) => planningApi.epics({}, signal), staleTime: STALE.minute });
  const epicName = useMemo(() => new Map((epics.data?.items ?? []).map((epic) => [epic.id, epic.title])), [epics.data]);
  const people = usePeopleNames(swim === "assignee");

  const { lanes, laneQueries, laneRows, byId, laneIds } = useTaskLanes(view, perLane);
  const { move, pending } = useMoveTask(term, filters, perLane);
  const { swimLabel, swimKeys, keyFor, dragLanes, rowsIn, neighbours } = useSwimlanes(
    swim, laneRows, laneIds, epicName, people.data,
  );

  const board = useBoardDrag({
    enabled: canEdit,
    lanes: dragLanes,
    items: (lane) => rowsIn(lane).map((task) => task.id),
    // The lanes are arranged by hand, so a card lands exactly where the gap
    // was open: between any two cards, at the top, at the bottom, in its own
    // lane or another one.
    onDrop: (id, from, to: DropTarget) => {
      const task = byId.get(id);
      if (!task || !canEdit) return;
      const origin = Math.max(0, rowsIn(from).findIndex((row) => row.id === id));
      const target = parseLane(to.lane);
      const source = parseLane(from);
      const field =
        swim !== "none" && target.swim !== source.swim
          ? { name: SWIMLANE_FIELD[swim], value: target.swim || null }
          : undefined;
      // The index is within the swimlane; the cache holds the whole status lane.
      const before = neighbours(to.lane, to.index, id).beforeId;
      const statusRows = (laneRows[laneIds.indexOf(target.status)] ?? []).filter((row) => row.id !== id);
      const at = before ? Math.max(0, statusRows.findIndex((row) => row.id === before)) : statusRows.length;
      move.mutate({
        task,
        to: target.status,
        index: swim === "none" ? to.index : at,
        field,
        ...neighbours(to.lane, to.index, id),
        undo: field ? undefined : { to: source.status, index: origin, ...neighbours(from, origin, id) },
      });
    },
    describe: (id) => {
      const task = byId.get(id);
      return [task?.reference, task?.title].filter(Boolean).join(" ") || "the card";
    },
    laneName: (lane) => {
      const { swim: key, status } = parseLane(lane);
      return swim === "none" ? laneName(status) : `${laneName(status)} in ${swimLabel(key)}`;
    },
  });

  return {
    swim, epics, epicName, lanes, laneQueries, laneIds, pending,
    swimLabel, swimKeys, keyFor, rowsIn, board, carried: board.drag,
  };
}

export type TasksBoard = ReturnType<typeof useTasksBoard>;
