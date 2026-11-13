import { Form, Segmented, Select, Space } from "antd";

import type { AnalysisCatalogue } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import type { DocumentBlock } from "@/api/reportDocuments";
import { ChartKindStrip } from "@/components/charts/ChartKindStrip";
import { fittingShapes, missingFor, shapeFor } from "@/components/charts/shapes";

/**
 * A chart block's question, composed in the rail (§28).
 *
 * The same four parts the chart builder asks for — *which rows, grouped how,
 * measured how, drawn how* — in the same order and out of the same catalogue.
 * A person who has built a chart once already knows this form, and a question
 * posed here is one `/charts/builder` would accept verbatim.
 *
 * The one rule this enforces that a free-form builder does not: **a kind that
 * cannot read the question is never left selected.** Switching the grouping
 * from a date to a category makes a line chart nonsense, so the kind falls
 * back to one that fits rather than the block rendering an empty picture and
 * leaving somebody to work out which of the two controls was at fault.
 */
export function ChartQuestion({
  block,
  catalogue,
  onChange,
}: {
  block: DocumentBlock;
  catalogue?: AnalysisCatalogue;
  onChange: (patch: Partial<DocumentBlock>) => void;
}) {
  const datasets = catalogue?.datasets ?? [];
  const dataset = datasets.find((item) => item.key === block.entity);
  const groupings = [
    ...(dataset?.dates ?? []).map((date) => ({ ...date, date: true })),
    ...(dataset?.dimensions ?? []).map((dimension) => ({ ...dimension, date: false })),
  ];
  const chosen = groupings.find((item) => item.name === block.dimension);
  const overTime = Boolean(chosen?.date);
  const aggregation = block.aggregation ?? "count";

  const draft = {
    dimensions: block.stack ? 2 : 1,
    measures: 1,
    overTime,
  };
  const fits = fittingShapes(draft);
  const kind = (block.chart ?? "bar") as ChartKind;

  /** A question changed, with the kind kept legal. */
  const ask = (patch: Partial<DocumentBlock>) => {
    const next = { ...block, ...patch };
    const nextChosen = groupings.find((item) => item.name === next.dimension);
    const nextDraft = {
      dimensions: next.stack ? 2 : 1,
      measures: 1,
      overTime: Boolean(nextChosen?.date),
    };
    const shape = shapeFor((next.chart ?? "bar") as ChartKind);
    if (shape && missingFor(shape, nextDraft)) {
      const fallback = fittingShapes(nextDraft)[0];
      if (fallback) patch = { ...patch, chart: fallback.kind };
    }
    onChange(patch);
  };

  return (
    <>
      <Form.Item label="Dataset" extra="Which rows the question is asked of.">
        <Select
          value={block.entity}
          // A new dataset invalidates every column name the old one offered,
          // so the grouping and the measure go with it rather than pointing at
          // a field this dataset has never heard of.
          onChange={(value) => ask({ entity: value, dimension: "", stack: "", measure: "" })}
          aria-label="Dataset"
          showSearch
          optionFilterProp="label"
          options={datasets.map((item) => ({ value: item.key, label: item.label }))}
          placeholder="Choose a dataset"
        />
      </Form.Item>

      <Form.Item label="Group by" extra="One bar, slice or point per value of this.">
        <Select
          value={block.dimension || undefined}
          onChange={(value) => ask({ dimension: value })}
          aria-label="Group by"
          disabled={!dataset}
          showSearch
          optionFilterProp="label"
          options={groupings.map((item) => ({
            value: item.name,
            label: item.date ? `${item.label} (date)` : item.label,
          }))}
          placeholder={dataset ? "Choose a column" : "Choose a dataset first"}
        />
      </Form.Item>

      {overTime && (
        <Form.Item label="Bucketed by">
          <Segmented
            block
            value={block.granularity || "month"}
            onChange={(value) => ask({ granularity: String(value) })}
            options={(catalogue?.granularities ?? []).map((grain) => ({
              value: grain,
              label: grain[0]!.toUpperCase() + grain.slice(1),
            }))}
          />
        </Form.Item>
      )}

      <Form.Item label="Split by" extra="Optional — a second grouping, for stacks and heatmaps.">
        <Select
          value={block.stack || undefined}
          onChange={(value) => ask({ stack: value || "" })}
          aria-label="Split by"
          allowClear
          disabled={!dataset}
          showSearch
          optionFilterProp="label"
          options={(dataset?.dimensions ?? [])
            .filter((item) => item.name !== block.dimension)
            .map((item) => ({ value: item.name, label: item.label }))}
          placeholder="Nothing"
        />
      </Form.Item>

      <Form.Item label="Measure" extra="What the height of a bar means.">
        <Space.Compact block>
          <Select
            value={aggregation}
            onChange={(value) =>
              ask({ aggregation: value, ...(value === "count" ? { measure: "" } : {}) })
            }
            aria-label="Measure"
            style={{ width: aggregation === "count" ? "100%" : "40%" }}
            options={(catalogue?.aggregations ?? []).map((item) => ({
              value: item.key,
              label: item.label,
            }))}
          />
          {aggregation !== "count" && (
            <Select
              value={block.measure || undefined}
              onChange={(value) => ask({ measure: value })}
              aria-label="Measure column"
              style={{ width: "60%" }}
              showSearch
              optionFilterProp="label"
              options={(dataset?.measures ?? []).map((item) => ({
                value: item.name,
                label: item.label,
              }))}
              placeholder="of what"
            />
          )}
        </Space.Compact>
      </Form.Item>

      <Form.Item label="Over" extra="The window the rows are taken from.">
        <Select
          value={block.period || ""}
          onChange={(value) => ask({ period: value })}
          aria-label="Period"
          options={[
            { value: "", label: "All time" },
            ...(catalogue?.periods ?? []).map((item) => ({ value: item.key, label: item.label })),
          ]}
        />
      </Form.Item>

      <Form.Item
        label="Drawn as"
        // Only the kinds this question can actually feed: an unfittable kind
        // offered and then silently ignored is worse than one not offered.
        extra={`${fits.length} shapes fit this question.`}
      >
        <ChartKindStrip
          kinds={fits.map((shape) => shape.kind)}
          value={kind}
          onChange={(value) => onChange({ chart: value })}
        />
      </Form.Item>

      <Form.Item label="Show" extra="The picture, its numbers, or both.">
        <Segmented
          block
          value={block.show ?? "chart"}
          onChange={(value) => onChange({ show: value as DocumentBlock["show"] })}
          options={[
            { value: "chart", label: "Chart" },
            { value: "table", label: "Table" },
            { value: "both", label: "Both" },
          ]}
        />
      </Form.Item>
    </>
  );
}
