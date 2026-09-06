/** Read long-form text as prose and structured attributes as labelled values. */
import { Descriptions, Empty, Tag, Typography } from "antd";
import type { RecordDetail, RecordField } from "@/api/records";
import { HighlightedText } from "@/components/HighlightedText";
import { asText } from "@/lib/text";
import { formatDateTime, formatNumber } from "@/lib/formats";
import { knownStatusColor } from "@/theme/tokens";

export function RecordContent({ record, term }: { record: RecordDetail; term: string }) {
  const contentNames = new Set(record.content_fields);
  const content = record.fields.filter((field) => contentNames.has(field.name));
  const metadata = record.fields.filter((field) => !contentNames.has(field.name));

  return <div className="nu-record-content">
    <section aria-label="Full text">
      <Typography.Title level={3}>Full text</Typography.Title>
      {content.some((field) => field.value) ? content.map((field) => field.value ? (
        <article key={field.name} aria-label={field.label} className="nu-record-prose">
          <Typography.Text type="secondary">{field.label}</Typography.Text>
          {/* React escapes stored text; paragraph boundaries survive verbatim. */}
          <p><HighlightedText text={asText(field.value)} term={term} /></p>
        </article>
      ) : null) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="This record has no full text. Its details are shown below." />}
    </section>
    <section aria-label="Metadata">
      <Typography.Title level={3}>Metadata</Typography.Title>
      <Descriptions className="nu-preview" column={1} size="small" bordered
        items={metadata.map((field) => ({ key: field.name, label: field.label,
          children: <RecordValue field={field} /> }))} />
    </section>
    <section aria-label="Additional metadata">
      <Typography.Title level={3}>Additional metadata</Typography.Title>
      {Object.keys(record.metadata).length > 0 ? <Descriptions column={1} size="small" bordered
        items={Object.entries(record.metadata).map(([name, value]) => ({ key: name, label: name,
          children: <StructuredValue value={value} /> }))} />
        : <Typography.Text type="secondary">No additional metadata.</Typography.Text>}
    </section>
  </div>;
}

function StructuredValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <Typography.Text type="secondary">—</Typography.Text>;
  if (typeof value === "object") return <pre className="nu-record-json">{JSON.stringify(value, null, 2)}</pre>;
  return <Typography.Text>{asText(value)}</Typography.Text>;
}

function RecordValue({ field }: { field: RecordField }) {
  const { value, kind } = field;
  if (value === null || value === undefined || value === "") return <Typography.Text type="secondary">—</Typography.Text>;
  if (kind === "bool") return <Typography.Text>{value === true ? "Yes" : "No"}</Typography.Text>;
  if (kind === "datetime") {
    const date = new Date(asText(value));
    return <Typography.Text>{Number.isNaN(date.valueOf()) ? asText(value) : formatDateTime(date)}</Typography.Text>;
  }
  if (kind === "number" && typeof value === "number") return <Typography.Text>{formatNumber(value)}</Typography.Text>;
  if (kind === "enum") return <Tag style={{ borderInlineStart: `3px solid ${knownStatusColor(asText(value)) ?? "var(--nu-border)"}` }}>{asText(value)}</Tag>;
  return <StructuredValue value={value} />;
}
