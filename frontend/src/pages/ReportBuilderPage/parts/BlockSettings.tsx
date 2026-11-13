import { Alert, Button, Form, Input, InputNumber, Segmented, Select, Typography } from "antd";
import { Link } from "react-router-dom";

import type { AnalysisCatalogue } from "@/api/analysis";
import type { DocumentBlock } from "@/api/reportDocuments";
import { BLOCK_SPECS } from "@/components/documents/blocks";

import { ChartQuestion } from "../parts/ChartQuestion";

const { Paragraph, Text } = Typography;

/** What one block shows. The kind decides which controls appear. */
export function BlockSettings({
  block,
  canEdit,
  datasets,
  reports,
  catalogue,
  onChange,
  onClose,
}: {
  block: DocumentBlock;
  canEdit: boolean;
  datasets: { key: string; label: string }[];
  reports: { id: string; name: string; visualization: string }[];
  catalogue?: AnalysisCatalogue;
  onChange: (patch: Partial<DocumentBlock>) => void;
  onClose: () => void;
}) {
  const spec = BLOCK_SPECS[block.kind];
  return (
    <div className="nu-doc-panel">
      <div className="nu-doc-panel-head">
        <Text strong>{spec.label}</Text>
        <Button type="text" onClick={onClose}>
          The page
        </Button>
      </div>
      <Paragraph type="secondary" className="nu-doc-panel-note">
        {spec.hint}
      </Paragraph>

      <Form layout="vertical" size="small" disabled={!canEdit}>
        {block.kind === "HEADING" && (
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
        )}

        {block.kind === "TEXT" && (
          <Form.Item label="Paragraph" extra="A blank line starts a new paragraph.">
            <Input.TextArea
              rows={8}
              value={block.text}
              onChange={(event) => onChange({ text: event.target.value })}
              aria-label="Paragraph"
            />
          </Form.Item>
        )}

        {block.kind === "SPACER" && (
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
        )}

        {block.kind === "REPORT" && (
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
                    <Link to="/charts/builder">chart builder</Link> and saved. Build one, then come
                    back — this block will draw it with today&apos;s data every time the file is
                    written.
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
        )}

        {block.kind === "CHART" && (
          <ChartQuestion block={block} catalogue={catalogue} onChange={onChange} />
        )}

        {(block.kind === "TABLE" || block.kind === "METRICS") && (
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
        )}

        {block.kind === "TABLE" && (
          <>
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
        )}

        {block.kind !== "HEADING" &&
          block.kind !== "TEXT" &&
          block.kind !== "SPACER" &&
          block.kind !== "DIVIDER" &&
          block.kind !== "PAGE_BREAK" && (
            <Form.Item label="Caption" extra="A line above it, naming what it shows.">
              <Input
                value={block.caption}
                onChange={(event) => onChange({ caption: event.target.value })}
                aria-label="Caption"
              />
            </Form.Item>
          )}
      </Form>
    </div>
  );
}
