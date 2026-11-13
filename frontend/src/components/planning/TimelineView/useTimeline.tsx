import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button } from "antd";
import { useMemo, useState } from "react";

import { ApiError } from "@/api/client";
import {
  planningApi,
  type Dependency,
  type Timeline,
  type TimelineBar,
  type Violation,
} from "@/api/planning";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

import { shortDate, windowFor } from "../gantt";
import { queryKeys } from "@/lib/queryKeys";
import type { TimelineState } from "./state";

export interface Warning {
  bar: { id: string; reference: string; title: string };
  start: string;
  end: string;
  violations: Violation[];
}

/** The timeline's window, its query, and the three writes on it: schedule (with undo), link and unlink. */
export function useTimeline(state: TimelineState, fixedProject?: string) {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [term, setTerm] = useState(state.q);
  const search = useDebouncedValue(term, 300);
  const [warning, setWarning] = useState<Warning | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const range = windowFor(state.zoom, today);
  const project = fixedProject ?? state.project;
  const key = queryKeys.timeline(state.group, range.from, range.to, project, search, state.done);

  const timeline = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      planningApi.timeline(
        {
          group: state.group,
          from: range.from,
          to: range.to,
          project_id: project || undefined,
          q: search || undefined,
          include_done: state.done,
        },
        signal,
      ),
    placeholderData: (previous) => previous,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.timeline() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.taskPlanning() });
  };
  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : "That change could not be saved.");

  const schedule = useMutation({
    mutationFn: ({ bar, start, end, shift }: { bar: Pick<TimelineBar, "id" | "reference" | "title" | "updated_at">; start: string; end: string; shift?: boolean; undo?: { start: string; end: string } }) =>
      planningApi.schedule(bar.id, { start_date: start, due_date: end, shift_dependants: shift }),
    onMutate: async ({ bar, start, end }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Timeline>(key);
      queryClient.setQueryData<Timeline>(key, (current) =>
        current
          ? {
              ...current,
              groups: current.groups.map((group) => ({
                ...group,
                items: group.items.map((item) => (item.id === bar.id ? { ...item, start, end, scheduled: true } : item)),
              })),
            }
          : current,
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      failed(error);
    },
    onSuccess: (result, { bar, start, end, shift, undo }) => {
      if (result.violations.length > 0) {
        setWarning({ bar, start, end, violations: result.violations });
        return;
      }
      setWarning(null);
      if (shift) {
        message.success(
          result.shifted.length
            ? `${result.shifted.length} dependent task${result.shifted.length === 1 ? "" : "s"} moved along`
            : "Nothing downstream needed to move",
        );
        return;
      }
      message.success({
        content: (
          <span>
            {bar.reference} now runs {shortDate(start)} – {shortDate(end)}{" "}
            {undo && (
              <Button
                type="text"
                onClick={() => schedule.mutate({ bar, start: undo.start, end: undo.end })}
              >
                Undo
              </Button>
            )}
          </span>
        ),
        duration: 5,
      });
    },
    onSettled: refresh,
  });

  const link = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      planningApi.link({ predecessor_id: from, successor_id: to }),
    onSuccess: (created) => {
      const pred = bars.get(created.predecessor_id);
      const succ = bars.get(created.successor_id);
      if (created.violated && pred && succ) {
        setWarning({
          bar: pred,
          start: pred.start,
          end: pred.end,
          violations: [
            {
              dependency_id: created.id,
              side: "successor",
              predecessor: { id: pred.id, reference: pred.reference, title: pred.title, end: pred.end },
              successor: { id: succ.id, reference: succ.reference, title: succ.title, start: succ.start },
              overlap_days: 0,
            },
          ],
        });
      } else {
        message.success(`${succ?.reference ?? "That task"} now waits on ${pred?.reference ?? "the other"}`);
      }
    },
    onError: failed,
    onSettled: refresh,
  });

  const unlink = useMutation({
    mutationFn: (dependency: Dependency) => planningApi.unlink(dependency.id),
    onSuccess: () => message.success("Dependency removed"),
    onError: failed,
    onSettled: refresh,
  });

  const data = timeline.data;
  const bars = useMemo(() => {
    const map = new Map<string, TimelineBar>();
    for (const group of data?.groups ?? []) for (const bar of group.items) map.set(bar.id, bar);
    return map;
  }, [data]);

  return { timeline, data, bars, schedule, link, unlink, warning, setWarning, range, term, setTerm };
}
