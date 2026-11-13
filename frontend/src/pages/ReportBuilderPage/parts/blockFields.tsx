/**
 * The block settings registry: which controls each block kind shows (§28).
 *
 * Keyed on the block kind; a kind with no entry has nothing of its own to set
 * (a divider, a page break). `CAPTIONED` names the kinds that carry a caption,
 * which is every kind that draws data.
 */

import { Alert, Form, Input, InputNumber, Segmented, Select } from "antd";
import { Link } from "react-router-dom";

import type { AnalysisCatalogue } from "@/api/analysis";
import type { BlockKind, DocumentBlock } from "@/api/reportDocuments";

import { ChartQuestion } from "./ChartQuestion";

export interface FieldsProps {
  block: DocumentBlock;
  onChange: (patch: Partial<DocumentBlock>) => void;
  datasets: { key: string; label: string }[];
  reports: { id: string; name: string; visualization: string }[];
  catalogue?: AnalysisCatalogue;
}

/** A heading: its words and its level. */
function HeadingFields({ block, onChange }: FieldsProps) {
  return (
    <>
      <Form.Item label="Text">
        <Input
          value={block.text}
          autoFocus
          onChange={(event) => onChange({ text: event.target.value })}
          aria-label="Heading text"
        />
      </Form.Item>
      <Form.Item label="Level">
        <Segmented
          block
          value={block.level ?? 2}
          onChange={(value) => onChange({ level: Number(value) })}
          options={[
            { value: 1, label: "Title" },
            { value: 2, label: "Section" },
            { value: 3, label: "Sub" },
          ]}
        />
      </Form.Item>
    </>
  );
}

/** A paragraph. */
function TextFields({ block, onChange }: FieldsProps) {
  return (
    <Form.Item label="Paragraph" extra="A blank line starts a new paragraph.">
      <Input.TextArea
        rows={8}
        value={block.text}
        onChange={(event) => onChange({ text: event.target.value })}
        aria-label="Paragraph"
      />
    </Form.Item>
  );
}

/** How much room a spacer leaves. */
function SpacerFields({ block, onChange }: FieldsProps) {
  return (
    <Form.Item label="How much room">
      <Segmented
        block
        value={block.size ?? "medium"}
        onChange={(value) => onChange({ size: String(value) })}
        options={[
          { value: "small", label: "Small" },
          { value: "medium", label: "Medium" },
          { value: "large", label: "Large" },
        ]}
      />
    </Form.Item>
  );
}

/** Which saved report, and whether to show its picture, its numbers or both. */
function ReportFields({ block, onChange, reports }: FieldsProps) {
  return (
    <>
      <Form.Item
        label="Which report"
        extra="Run when the file is written, so the document is never stale."
      >
        <Select
          value={block.report_id}
          onChange={(value) => onChange({ report_id: value })}
          aria-label="Report"
          showSearch
          optionFilterProp="label"
          options={reports.map((report) => ({
            value: report.id,
            label: `${report.name} · ${report.visualization}`,
          }))}
          notFoundContent="You have not saved a report yet"
        />
      </Form.Item>
      {reports.length === 0 && (
        // Offered with the way out rather than left as an empty select:
        // the chart builder is where a picture is composed, and this is
        // the one moment somebody needs to be told that (§76).
        <Alert
          type="info"
          showIcon
          className="nu-block"
          message="No saved reports yet"
          description={
            <>
              A chart on a page is one you built in the{" "}
              <Link to="/charts/builder">chart builder</Link> and saved. Build one, then come back —
              this block will draw it with today&apos;s data every time the file is written.
            </>
          }
        />
      )}
      <Form.Item label="Show" extra="The picture, its numbers, or both.">
        <Segmented
          block
          value={block.show ?? "both"}
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

/** A chart block composes its own question. */
function ChartFields({ block, onChange, catalogue }: FieldsProps) {
  return <ChartQuestion block={block} catalogue={catalogue} onChange={onChange} />;
}

/** Which dataset a metrics strip reads. */
function DatasetField({ block, onChange, datasets }: FieldsProps) {
  return (
    <Form.Item label="Dataset">
      <Select
        value={block.entity}
        onChange={(value) => onChange({ entity: value })}
        aria-label="Dataset"
        showSearch
        optionFilterProp="label"
        options={datasets.map((item) => ({ value: item.key, label: item.label }))}
      />
    </Form.Item>
  );
}

/** Which dataset a table reads, in what order, and how many rows. */
function TableFields({ block, onChange, datasets }: FieldsProps) {
  return (
    <>
      <Form.Item label="Dataset">
        <Select
          value={block.entity}
          onChange={(value) => onChange({ entity: value })}
          aria-label="Dataset"
          showSearch
          optionFilterProp="label"
          options={datasets.map((item) => ({ value: item.key, label: item.label }))}
        />
      </Form.Item>
      <Form.Item label="Sort by" extra="Leave empty for the dataset's own order.">
        <Input
          value={block.sort}
          onChange={(event) => onChange({ sort: event.target.value })}
          placeholder="updated_at"
          aria-label="Sort by"
        />
      </Form.Item>
      <Form.Item label="Direction">
        <Segmented
          block
          value={block.order ?? "desc"}
          onChange={(value) => onChange({ order: value as "asc" | "desc" })}
          options={[
            { value: "desc", label: "Newest first" },
            { value: "asc", label: "Oldest first" },
          ]}
        />
      </Form.Item>
      <Form.Item label="How many rows" extra="Up to 200. Past that, use an export (§30).">
        <InputNumber
          min={1}
          max={200}
          value={block.limit ?? 20}
          onChange={(value) => onChange({ limit: Number(value ?? 20) })}
          style={{ width: "100%" }}
          aria-label="How many rows"
        />
      </Form.Item>
    </>
  );
}

export const BLOCK_FIELDS: Partial<Record<BlockKind, (props: FieldsProps) => JSX.Element>> = {
  HEADING: HeadingFields,
  TEXT: TextFields,
  SPACER: SpacerFields,
  REPORT: ReportFields,
  CHART: ChartFields,
  TABLE: TableFields,
  METRICS: DatasetField,
};

/** The kinds that carry a caption: every kind that draws data. */
export const CAPTIONED: ReadonlySet<BlockKind> = new Set<BlockKind>([
  "REPORT",
  "CHART",
  "TABLE",
  "METRICS",
]);
