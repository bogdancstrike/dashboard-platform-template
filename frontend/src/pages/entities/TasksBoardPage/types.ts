/** What the board asks for per lane, the row it gets back, and one move. */

/** Rows fetched per lane. A lane is scanned, not read to the end. */
export const PER_LANE = 12;

export const COLUMNS = [
  "reference", "title", "status", "priority", "kind",
  "due_date", "progress", "estimate_hours", "logged_hours", "updated_at", "board_position",
  // Work planning (§18): what a card shows beyond its title.
  "story_points", "cover_color", "blocked_reason", "checklist", "epic_id", "assignee_id",
  "status_changed_at",
];
/** Rows per lane with swimlanes on: each swimlane takes its share of a lane. */
export const PER_LANE_SWIMMING = 40;

/** One drop: where to, between whom, and how to take it back. */
export interface Move {
  task: TaskRow;
  to: string;
  /** A drop into another swimlane also writes the field the swimlanes are. */
  field?: { name: string; value: string | null };
  /** Position in the target lane, counted without the card. */
  index: number;
  afterId: string | null;
  beforeId: string | null;
  undo?: Omit<Move, "task" | "undo">;
}

/** A type, not an interface, so a card reads as a plain record where swimlanes look up a field by name. */
export type TaskRow = {
  id: string;
  reference?: string;
  title?: string;
  status?: string;
  priority?: string;
  kind?: string;
  due_date?: string | null;
  progress?: number;
  estimate_hours?: number;
  logged_hours?: number;
  updated_at?: string | null;
  story_points?: number | null;
  cover_color?: string | null;
  blocked_reason?: string | null;
  checklist?: { text?: string; done?: boolean }[] | null;
  epic_id?: string | null;
  assignee_id?: string | null;
  status_changed_at?: string | null;
};
