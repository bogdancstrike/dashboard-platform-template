import type { DashboardWidget } from "@/api/dashboards";

/**
 * Whether a widget yet knows *what* it is about.
 *
 * A kind is a shape; a subject is the dataset, report, search or insight it
 * draws. The create flow picks the first and leaves the second, so this
 * distinguishes "unfinished" from "broken" — and only the second is worth an
 * error. The configure modal asks the same question one step earlier: a draft
 * with no subject is a preview that has nothing to draw (§34).
 */
export function hasSubject(widget: DashboardWidget): boolean {
  if (widget.kind === "REPORT") return Boolean(widget.config.report_id);
  if (widget.kind === "SEARCH") return Boolean(widget.config.search_id);
  if (widget.kind === "INSIGHT") return Boolean(widget.config.insight_id);
  return Boolean(widget.config.entity);
}
