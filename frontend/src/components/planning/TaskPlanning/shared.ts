import { useQuery, useQueryClient } from "@tanstack/react-query";

import { planningApi } from "@/api/planning";
import { refreshRecordViews } from "@/lib/refresh";

import { queryKeys } from "@/lib/queryKeys";

// Stored on the task as `cover_color` and seeded with these exact strings, so
// they are data the server keeps rather than styling. palette-exempt
export const COVERS = ["#2457D6", "#7c3aed", "#0891b2", "#16a34a", "#ca8a04", "#dc2626", "#db2777", "#64748b"];

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function useTaskPlanning(id: string) {
  return useQuery({
    queryKey: queryKeys.taskPlanning(id),
    queryFn: ({ signal }) => planningApi.planning(id, signal),
    enabled: Boolean(id),
  });
}

export function useRefresh(id: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.taskPlanning(id) });
    refreshRecordViews(queryClient);
  };
}

export const SAVE_FAILED = "That could not be saved.";
