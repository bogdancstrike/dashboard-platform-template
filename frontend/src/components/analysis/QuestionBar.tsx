/**
 * The analysis question, as one bar (§28, §44).
 *
 * Both builders asked the same thing in the same way and wrote it out twice:
 * eight selects in a column, each with a bold label above it and a line of
 * guidance below. Seven hundred vertical pixels of form, two hundred lines of
 * near-identical JSX, and the *answer* — the thing the page exists to show —
 * got whatever width was left over. The report builder's copy had already
 * drifted: its "Then by" hint said "drawn as a stack", the chart builder's
 * said "a stack, a nest, a heatmap's columns", and only one of them was true
 * for the page it was on.
 *
 * So it is a bar, and it reads as a sentence being assembled:
 *
 *     Orders · grouped by Status ▾ · measuring Sum ▾ of Total ▾ · over All time ▾
 *
 * Two consequences worth stating.
 *
 * **The label goes inside the control**, as a prefix on the select rather than
 * a heading above it. A field with a heading, a control and a hint is three
 * rows tall; the same field is one row when the heading is a word in front of
 * it, and the reader loses nothing because the word is still there.
 *
 * **The guidance moves to the control's own tooltip.** A hint that is on
 * screen permanently is read once and then costs a line forever — and there
 * were eight of them. What each grouping and measure *does* is still one hover
 * away, where somebody who does not know goes looking.
 *
 * What may be picked comes from `/api/analysis/catalog`, which is generated
 * from the resource declarations, so this cannot offer a column the compiler
 * would reject and a field added to a dataset appears here with no change.
 */

import { Select, Space, Tooltip, Typography } from "antd";

import type { AnalysisCatalogue } from "@/api/analysis";
import { DRAFT_KEYS, type AnalysisDraft } from "@/entities/analysisDraft";

const { Text } = Typography;

/** What each control is *for*, said on hover rather than permanently. */
const GUIDANCE = {
  resource: "Which records the question is asked of.",
  group: "The first axis. A date is read in the bucket beside it.",
  stack: "A second grouping — a stack, a nest, a heatmap's columns.",
  measure: "What is counted or added up for each group.",
  measure2: "A second measure. A scatter reads it as the vertical axis.",
  period: "How far back to look. Filters the rows, not the groups.",
} as const;

export interface QuestionBarProps {
  catalogue: AnalysisCatalogue | undefined;
  draft: AnalysisDraft;
  /** Write these keys into the address bar; `null` removes one. */
  onChange: (changes: Record<string, string | null>) => void;
  /**
   * Whether to offer the second measure.
   *
   * Only the chart builder does: a scatter is the one picture that reads two,
   * and a control that exists to feed a kind the page cannot draw is a control
   * that produces an error rather than a result.
   */
  withSecondMeasure?: boolean;
}

export function QuestionBar({
  catalogue,
  draft,
  onChange,
  withSecondMeasure = false,
}: QuestionBarProps) {
  const datasets = catalogue?.datasets ?? [];
  const dataset = datasets.find((item) => item.key === draft.resource);
  const groupings = dataset?.dimensions ?? [];
  const columns = dataset?.measures ?? [];
  const grouped = groupings.find((item) => item.name === draft.group);

  /** Only a date buckets; offering it elsewhere is a control that errors. */
  const bucketable = grouped?.kind === "datetime";

  return (
    <div className="nu-question" data-testid="question-bar">
      <Part label="Dataset" hint={GUIDANCE.resource}>
        <Select
          aria-label="Dataset"
          className="nu-question-select"
          popupMatchSelectWidth={false}
          value={draft.resource || undefined}
          onChange={(next: string) =>
            // Every choice below names a column of the old dataset, so all of
            // them go: a stale `group` would be a question the compiler
            // rejects, reported as though the reader had asked for it.
            onChange({
              [DRAFT_KEYS.resource]: next,
              [DRAFT_KEYS.group]: null,
              [DRAFT_KEYS.grain]: null,
              [DRAFT_KEYS.stack]: null,
              [DRAFT_KEYS.measure]: null,
              [DRAFT_KEYS.measure2]: null,
              [DRAFT_KEYS.aggregation2]: null,
            })
          }
          options={datasets.map((item) => ({ value: item.key, label: item.label }))}
        />
      </Part>

      <Part label="Grouped by" hint={GUIDANCE.group}>
        <Select
          aria-label="Group by"
          className="nu-question-select"
          allowClear
          showSearch
          optionFilterProp="label"
          popupMatchSelectWidth={false}
          placeholder="Nothing — one row"
          value={draft.group || undefined}
          onChange={(next: string | undefined) =>
            onChange({ [DRAFT_KEYS.group]: next ?? null, [DRAFT_KEYS.grain]: null })
          }
          options={groupings.map((item) => ({ value: item.name, label: item.label }))}
        />
        {bucketable && (
          <Select
            aria-label="Granularity"
            className="nu-question-select nu-question-select--narrow"
            allowClear
            popupMatchSelectWidth={false}
            placeholder="Bucket"
            value={draft.grain || undefined}
            onChange={(next: string | undefined) => onChange({ [DRAFT_KEYS.grain]: next ?? null })}
            options={(catalogue?.granularities ?? []).map((item) => ({
              value: item,
              label: item,
            }))}
          />
        )}
      </Part>

      <Part label="Then by" hint={GUIDANCE.stack}>
        <Select
          aria-label="Then by"
          className="nu-question-select"
          allowClear
          showSearch
          optionFilterProp="label"
          popupMatchSelectWidth={false}
          placeholder="Nothing"
          value={draft.stack || undefined}
          onChange={(next: string | undefined) => onChange({ [DRAFT_KEYS.stack]: next ?? null })}
          options={groupings
            .filter((item) => item.name !== draft.group && item.kind !== "datetime")
            .map((item) => ({ value: item.name, label: item.label }))}
        />
      </Part>

      <Part label="Measuring" hint={GUIDANCE.measure}>
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

      {withSecondMeasure && (
        <Part label="Against" hint={GUIDANCE.measure2}>
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
      )}

      <Part label="Over" hint={GUIDANCE.period}>
        <Select
          aria-label="Period"
          className="nu-question-select"
          popupMatchSelectWidth={false}
          value={draft.period}
          onChange={(next: string) => onChange({ [DRAFT_KEYS.period]: next })}
          options={[
            ...(catalogue?.periods ?? []).map((item) => ({
              value: item.key,
              label: item.label,
            })),
            { value: "all_time", label: "All time" },
          ]}
        />
      </Part>
    </div>
  );
}

/**
 * One clause of the sentence: the word, then the control.
 *
 * The word is a `label` for what follows rather than a heading above it, which
 * is what makes the bar one row tall instead of three. The hint is the label's
 * tooltip, so it is available and costs nothing when it is not wanted.
 */
function Part({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="nu-question-part">
      <Tooltip title={hint}>
        <Text type="secondary" className="nu-question-label">
          {label}
        </Text>
      </Tooltip>
      <Space.Compact>{children}</Space.Compact>
    </div>
  );
}
