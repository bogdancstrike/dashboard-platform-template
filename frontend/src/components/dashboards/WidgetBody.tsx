/**
 * What one widget shows, fetched from the endpoint that owns the question
 * (§45).
 *
 * No widget computes anything here, and none has an endpoint of its own. A KPI
 * reads the dataset's declared insight metrics, a chart goes through the
 * analysis compiler, a list through the explorer query, and the alert strip and
 * activity feed through the dashboard summary the home page already uses. A
 * dashboard that recomputed any of them would be a second answer to a question
 * the platform has already answered — and the two would drift.
 *
 * Two decisions worth stating.
 *
 * **A widget with no grouping is complete, not broken.** The dataset declares
 * which of its fields is worth grouping by; a chart widget that names none
 * takes that default. Derived from the catalogue rather than invented here, so
 * a dataset whose declaration changes takes its widgets with it.
 *
 * **A widget that cannot be answered says so in place.** Not an empty card and
 * not a spinner that never resolves: which dataset, which permission, and the
 * correlation id (§34, §76). A dashboard is read at a glance, and a panel that
 * fails quietly is a number somebody will quote.
 */

import type { AnalysisCatalogue } from "@/api/analysis";
import type { DashboardWidget } from "@/api/dashboards";
import type { ExplorerResource } from "@/api/explorer";
import { EmptyState } from "@/components/EmptyState";
import { useFeatures } from "@/settings/features";

import { kindFlag } from "./kinds";
import { BODIES } from "./widgets/registry";
import { hasSubject } from "./widgets/subject";

export function WidgetBody({
  widget,
  period,
  catalogue,
  resources,
}: {
  widget: DashboardWidget;
  /** The dashboard's period, which a widget may override. */
  period: string;
  /** What may be grouped and measured, for the defaults a widget omits. */
  catalogue: AnalysisCatalogue | undefined;
  resources: ExplorerResource[];
}) {
  const features = useFeatures();
  const entity = widget.config.entity ?? "";

  // A widget whose feature has been switched off stays on the dashboard —
  // the layout is the owner's — and says why it is empty (§27).
  const flag = kindFlag(widget.kind);
  if (flag && !features(flag)) {
    return <EmptyState compact title="This widget's feature is switched off." />;
  }

  const entry = BODIES[widget.kind];
  // A widget created by the wizard has a shape and no subject yet. Said in
  // place, with the action, rather than drawn as an empty chart: a card that
  // looks like a failure and is only unfinished sends somebody debugging
  // (§34).
  if (entry.subject && !hasSubject(widget)) {
    return (
      <EmptyState compact title="Nothing chosen yet — open this widget&apos;s settings to say what it shows." />
    );
  }

  return entry.render({
    widget,
    period: widget.config.period ?? period,
    dataset: catalogue?.datasets.find((item) => item.key === entity),
    resource: resources.find((item) => item.key === entity),
    resources,
  });
}
