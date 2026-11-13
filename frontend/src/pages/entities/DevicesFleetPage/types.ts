/** The fields the fleet asks for, and the row they come back as. */

export const COLUMNS = [
  "serial", "name", "kind", "model", "manufacturer", "status", "location",
  "last_seen_at", "battery_percent", "signal_strength", "uptime_hours", "error_count",
];

export interface DeviceRow {
  id: string;
  serial?: string;
  name?: string;
  kind?: string;
  model?: string;
  manufacturer?: string;
  status?: string;
  location?: string;
  last_seen_at?: string | null;
  battery_percent?: number;
  signal_strength?: number;
  uptime_hours?: number;
  error_count?: number;
}
