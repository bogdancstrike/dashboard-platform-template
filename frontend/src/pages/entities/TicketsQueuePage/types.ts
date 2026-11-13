/** The fields the queue asks for, and the row they come back as. */

/**
 * `first_response_at`, `resolved_at` and `resolution_minutes` are asked for
 * although no column prints them: the SLA rule needs them to say whether a
 * ticket was answered, resolved, or resolved *late*.
 */
export const COLUMNS = [
  "reference", "subject", "status", "priority", "severity",
  "category", "channel", "due_at", "sla_breached",
  "first_response_at", "resolved_at", "resolution_minutes", "created_at",
];

export interface TicketRow {
  id: string;
  reference?: string;
  subject?: string;
  status?: string;
  priority?: string;
  severity?: string;
  category?: string;
  channel?: string;
  due_at?: string | null;
  sla_breached?: boolean;
  first_response_at?: string | null;
  resolved_at?: string | null;
  resolution_minutes?: number | null;
  created_at?: string | null;
}
