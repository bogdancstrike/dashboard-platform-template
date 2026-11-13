/** What the project page reads of its own work queue. */

/** What is worth reading of the project's own work queue, and in what order. */
export const TASK_COLUMNS = ["reference", "title", "status", "priority", "due_date", "progress"];

export interface TaskRow {
  id: string;
  reference?: string;
  title?: string;
  status?: string;
  priority?: string;
  due_date?: string | null;
  progress?: number;
}
