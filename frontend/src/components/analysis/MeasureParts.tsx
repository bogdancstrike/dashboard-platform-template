import { Select } from "antd";

import type { AnalysisCatalogue } from "@/api/analysis";
import { DRAFT_KEYS, type AnalysisDraft } from "@/entities/analysisDraft";

import { GUIDANCE, Part } from "./QuestionPart";

interface MeasureProps {
  catalogue: AnalysisCatalogue | undefined;
  draft: AnalysisDraft;
  onChange: (changes: Record<string, string | null>) => void;
  /** The chosen dataset's measurable columns. */
  columns: AnalysisCatalogue["datasets"][number]["measures"];
}

/** What is counted or added up: an aggregation, and the column it reads. */
export function MeasurePart({ catalogue, draft, onChange, columns }: MeasureProps) {
  return (
    <Part label="Measure" hint={GUIDANCE.measure}>
      <Select
        aria-label="Aggregation"
        className="nu-question-select nu-question-select--narrow"
        popupMatchSelectWidth={false}
        value={draft.aggregation}
        onChange={(next: string) =>
          onChange({
            [DRAFT_KEYS.aggregation]: next,
            // `count` measures rows and names no column, so the column that
            // was chosen for a `sum` must not survive into it.
            [DRAFT_KEYS.measure]: next === "count" ? null : draft.measure,
          })
        }
        options={(catalogue?.aggregations ?? []).map((item) => ({
          value: item.key,
          label: item.label,
        }))}
      />
      {draft.aggregation !== "count" && (
        <Select
          aria-label="Measured column"
          className="nu-question-select"
          showSearch
          optionFilterProp="label"
          popupMatchSelectWidth={false}
          placeholder="Pick a column"
          value={draft.measure || undefined}
          onChange={(next: string) => onChange({ [DRAFT_KEYS.measure]: next })}
          options={columns.map((item) => ({ value: item.name, label: item.label }))}
        />
      )}
    </Part>
  );
}

/** A second measure, which a scatter reads as its vertical axis. */
export function SecondMeasurePart({ catalogue, draft, onChange, columns }: MeasureProps) {
  return (
    <Part label="Compare against" hint={GUIDANCE.measure2}>
      <Select
        aria-label="Second aggregation"
        className="nu-question-select nu-question-select--narrow"
        allowClear
        popupMatchSelectWidth={false}
        placeholder="Nothing"
        value={draft.aggregation2 || undefined}
        onChange={(next: string | undefined) =>
          onChange({
            [DRAFT_KEYS.aggregation2]: next ?? null,
            [DRAFT_KEYS.measure2]: next && next !== "count" ? draft.measure2 : null,
          })
        }
        options={(catalogue?.aggregations ?? []).map((item) => ({
          value: item.key,
          label: item.label,
        }))}
      />
      {Boolean(draft.aggregation2) && draft.aggregation2 !== "count" && (
        <Select
          aria-label="Second measured column"
          className="nu-question-select"
          showSearch
          optionFilterProp="label"
          popupMatchSelectWidth={false}
          placeholder="Pick a column"
          value={draft.measure2 || undefined}
          onChange={(next: string) => onChange({ [DRAFT_KEYS.measure2]: next })}
          options={columns.map((item) => ({ value: item.name, label: item.label }))}
        />
      )}
    </Part>
  );
}
