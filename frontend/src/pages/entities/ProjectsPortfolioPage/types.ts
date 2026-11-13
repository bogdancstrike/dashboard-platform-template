/** The fields the list asks for, and the row they come back as. */

/**
 * `completed_at` and `currency` are asked for although no column shows them:
 * the standing rule needs to know a project is closed — "40% delivered on 90%
 * of the budget" is a finding on a live project and history on a finished one
 * — and money without its currency is a number, not an amount.
 */
export const COLUMNS = [
  "code", "name", "status", "phase", "health", "priority",
  "start_date", "due_date", "completed_at", "budget", "spent", "currency", "progress",
];

export interface ProjectRow {
  id: string;
  code?: string;
  name?: string;
  status?: string;
  phase?: string;
  health?: string;
  priority?: string;
  start_date?: string | null;
  due_date?: string | null;
  completed_at?: string | null;
  budget?: number;
  spent?: number;
  currency?: string;
  progress?: number;
}
