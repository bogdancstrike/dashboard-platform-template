import { Form, Input } from "antd";

import type { AnalysisCatalogue } from "@/api/analysis";
import type { WidgetKind } from "@/api/dashboards";

import { KINDS } from "../../kinds";
import { DatasetFields } from "./DatasetFields";
import { KindSelect } from "./KindSelect";
import { MODULE_FIELDS } from "./ModuleFields";
import { SavedSubjectField, isSaved } from "./SavedSubjectField";

/**
 * The configure form's fields: the name first, then the kind, then whatever
 * that kind asks — its subject, the question put to a dataset, or the options
 * of the page a module mirrors.
 */
export function WidgetFields({
  kind,
  kinds,
  datasets,
  dataset,
  periods,
}: {
  kind: WidgetKind;
  /** The kinds on offer, already filtered by feature flag. */
  kinds: WidgetKind[];
  datasets: { key: string; label: string }[];
  dataset: AnalysisCatalogue["datasets"][number] | undefined;
  periods: AnalysisCatalogue["periods"];
}) {
  const shape = KINDS[kind];
  const ModuleOptions = MODULE_FIELDS[kind];
  return (
    <>
      {/* The two fields every kind has, first — and in the order somebody
            fills them. What follows changes as the kind changes; a form whose
            first field moves depending on an answer further down reads as one
            that was assembled rather than designed. */}
      <Form.Item
        name="title"
        label="Title"
        rules={[{ required: true, message: "Say what this widget answers" }]}
      >
        <Input placeholder="Open tickets by severity" autoFocus />
      </Form.Item>
      <Form.Item name="subtitle" label="Note">
        <Input placeholder="Optional — scope, caveat, period" />
      </Form.Item>

      <KindSelect kind={kind} kinds={kinds} />
      {isSaved(shape.needs) && <SavedSubjectField needs={shape.needs} />}
      {shape.needs === "dataset" && (
        <DatasetFields kind={kind} datasets={datasets} dataset={dataset} periods={periods} />
      )}
      {ModuleOptions && <ModuleOptions datasets={datasets} />}
    </>
  );
}
