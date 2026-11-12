import { api } from "./client";

/**
 * Where a task sits on the task board (§18).
 *
 * A drop names its new neighbours rather than a number: the server reads their
 * ranks as they are now and writes the midpoint, so a move changes one row and
 * two tabs reordering the same lane cannot hand each other stale numbers.
 */
export interface TaskPlacement {
  id: string;
  status: string;
  board_position: number;
  updated_at: string | null;
}

export const taskBoardApi = {
  place: (
    id: string,
    input: {
      status: string;
      /** The card directly above it, or null for the top of the lane. */
      after_id: string | null;
      /** The card directly below it, or null for the bottom. */
      before_id: string | null;
      expected_updated_at?: string | null;
    },
  ) => api.post<TaskPlacement>(`/api/tasks/${id}/place`, input),
};
