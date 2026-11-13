import { useQuery } from "@tanstack/react-query";

import { analysisApi } from "@/api/analysis";
import { explorerApi } from "@/api/explorer";
import { recordsApi } from "@/api/records";
import { queryKeys } from "@/lib/queryKeys";

import { TASK_COLUMNS } from "./types";

/** The project's work, rolled up and soonest-first, and the account it is for. */
export function useProjectWork(id: string, customerId: string) {
  /**
   * The work under this project, grouped in SQL.
   *
   * Two questions, one endpoint: the lane counts are a `GROUP BY status` over
   * every task the project has, and the table below is the soonest few. The
   * counts therefore describe the whole queue rather than the rows on screen.
   */
  const rollup = useQuery({
    queryKey: queryKeys.recordAnalysis("project-tasks", id),
    queryFn: ({ signal }) =>
      analysisApi.run(
        {
          resource_type: "task",
          dimensions: ["status"],
          measures: [{ aggregation: "count" }],
          filters: { project_id: id },
        },
        signal,
      ),
    enabled: Boolean(id),
  });

  const nextUp = useQuery({
    queryKey: queryKeys.recordAnalysis("project-next-tasks", id),
    queryFn: ({ signal }) =>
      explorerApi.query(
        {
          resource_type: "task",
          filters: { project_id: id },
          columns: TASK_COLUMNS,
          sort: "due_date",
          order: "asc",
          page_size: 8,
        },
        signal,
      ),
    enabled: Boolean(id),
  });
  const account = useQuery({
    queryKey: queryKeys.record("customer", customerId),
    queryFn: ({ signal }) => recordsApi.get("customer", customerId, signal),
    // Fetched only once there is an account to fetch, so a project without a
    // customer costs nothing rather than a 404 on every open.
    enabled: Boolean(customerId),
  });

  return { rollup, nextUp, account };
}
