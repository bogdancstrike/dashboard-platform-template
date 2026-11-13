import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { explorerApi, type ExplorerRequest } from "@/api/explorer";
import type { EntityView } from "@/entities/useEntityView";
import { queryKeys } from "@/lib/queryKeys";

import { COLUMNS, type TaskRow } from "./types";

/** Each lane is its own query: its own total, its own page, its own order. */
export function useTaskLanes(view: EntityView, perLane: number) {
  const { resource, rows, filters, term } = view;

  /**
   * The lanes, and their order.
   *
   * Taken from the field's declared choices rather than from the values that
   * happen to be present: an empty "Blocked" lane is information, and a board
   * whose columns appear and disappear as work moves is one nobody can learn.
   */
  const lanes = useMemo(() => {
    const field = resource?.fields.find((item) => item.name === "status");
    const counts = new Map(
      (rows.data?.facets["status"] ?? []).map((facet) => [facet.value, facet.count]),
    );
    return (field?.choices ?? []).map((status) => ({
      status,
      total: counts.get(status) ?? 0,
    }));
  }, [resource, rows.data]);

  const laneQueries = useQueries({
    queries: lanes.map((lane) => ({
      queryKey: queryKeys.taskLane(lane.status, term, filters, perLane),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        explorerApi.query(
          {
            resource_type: "task",
            query_text: term,
            filters: { ...filters, status: lane.status },
            columns: COLUMNS,
            page: 1,
            page_size: perLane,
            // The board's own, hand-made order (§18): what a drop wrote is
            // what a reload shows.
            sort: "board_position",
            order: "asc",
          } satisfies ExplorerRequest,
          signal,
        ),
      enabled: Boolean(resource),
    })),
  });

  /** Every card drawn, by id, so the drag can name and move it. */
  const laneRows = lanes.map((lane, index) =>
    ((laneQueries[index]?.data?.items ?? []) as TaskRow[]).map((task) => ({
      ...task,
      status: task.status ?? lane.status,
    })),
  );
  const byId = new Map(laneRows.flat().map((task) => [task.id, task]));
  const laneIds = lanes.map((lane) => lane.status);

  return { lanes, laneQueries, laneRows, byId, laneIds };
}
