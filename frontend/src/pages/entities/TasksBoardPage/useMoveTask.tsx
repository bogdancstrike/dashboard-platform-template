import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button } from "antd";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { recordsApi } from "@/api/records";
import { taskBoardApi } from "@/api/taskBoard";
import { refreshRecordViews } from "@/lib/refresh";
import { queryKeys } from "@/lib/queryKeys";

import { withoutTask, withTask } from "./laneCache";
import type { Move } from "./types";

/** What a lane is called on screen — the vocabulary, not the enum. */
export const laneName = (status: string) => status.replace(/_/g, " ").toLowerCase();

/**
 * The board's one write, with the cards whose move is written and not yet
 * confirmed — they stay marked until the server answers.
 */
export function useMoveTask(term: string, filters: Record<string, string>, perLane: number) {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  /** Cards whose move is written and not yet confirmed, so they stay marked. */
  const [pending, setPending] = useState<string[]>([]);

  /**
   * Moving a card writes the record's status.
   *
   * Optimistic, then reconciled: the card lands immediately, and every lane is
   * refetched on the way out whether the write succeeded or failed. The totals
   * beside each lane name are counted over the whole dataset, so they cannot
   * be adjusted here without lying about the rows nobody has loaded.
   */
  const move = useMutation({
    mutationFn: async ({ task, to, afterId, beforeId, field }: Move) => {
      const placed = await taskBoardApi.place(task.id, {
        status: to,
        after_id: afterId,
        before_id: beforeId,
        expected_updated_at: task.updated_at ?? null,
      });
      if (!field) return placed;
      const saved = await recordsApi.update("task", task.id, {
        [field.name]: field.value,
        expected_updated_at: placed.updated_at,
      });
      return { ...placed, updated_at: saved.updated_at };
    },
    onMutate: async ({ task, to, index, field }) => {
      setPending((current) => [...current, task.id]);
      await queryClient.cancelQueries({ queryKey: queryKeys.taskLane() });
      const fromKey = queryKeys.taskLane(task.status ?? "", term, filters, perLane);
      const toKey = queryKeys.taskLane(to, term, filters, perLane);
      const previous = [
        [fromKey, queryClient.getQueryData(fromKey)],
        [toKey, queryClient.getQueryData(toKey)],
      ] as const;
      // Move the card between the two lane caches by hand, so the drop lands
      // exactly where the gap was drawn before the round trip. Counts are
      // left alone deliberately — see above.
      queryClient.setQueryData(fromKey, (current: unknown) => withoutTask(current, task.id));
      queryClient.setQueryData(toKey, (current: unknown) =>
        withTask(current, { ...task, status: to, ...(field ? { [field.name]: field.value } : {}) }, index),
      );
      return { previous };
    },
    onError: (error, { task }, context) => {
      // Put both lanes back exactly as they were, so the card is seen to
      // return rather than vanish, and say why: a card that snaps back with
      // no explanation reads as a broken drag rather than a lost race.
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
      const conflict = error instanceof ApiError && error.status === 409;
      message.error(
        conflict
          ? `${task.title ?? "That task"} moved on somebody else's screen — reloading the board.`
          : error instanceof ApiError
            ? error.message
            : "That move could not be saved.",
      );
    },
    onSuccess: (saved, { task, to, undo }) => {
      const from = task.status ?? "";
      if (!undo) return;
      // Confirmed, and taking it back is one press. A board is a surface
      // people drag on quickly, which means it is a surface people drop on
      // the wrong place quickly.
      message.success({
        content: (
          <span>
            {task.reference ?? "Task"} {from === to ? "reordered in" : "moved to"}{" "}
            {laneName(to)}{" "}
            <Button
              type="text"
              onClick={() =>
                move.mutate({
                  ...undo,
                  task: { ...task, status: to, updated_at: saved.updated_at ?? task.updated_at },
                })
              }
            >
              Undo
            </Button>
          </span>
        ),
        duration: 6,
      });
    },
    onSettled: (_saved, _error, { task }) => {
      setPending((current) => current.filter((id) => id !== task.id));
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskLane() });
      refreshRecordViews(queryClient);
    },
  });

  return { move, pending };
}
