/**
 * Editing one wiki block (§48). Each kind gets the controls its shape needs
 * and nothing more; a data block keeps a live preview beside its settings,
 * drawn by the report builder's own component.
 */

import { useQuery } from "@tanstack/react-query";
import { App as AntApp, Button, Checkbox, DatePicker, Input, Segmented, Select, Space, Switch, Typography, Upload } from "antd";
import { DeleteOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useState } from "react";

import type { DocBlock } from "@/api/docs";
import { explorerApi } from "@/api/explorer";
import { filesApi, putBytes } from "@/api/files";
import { reportsApi } from "@/api/reports";
import { PeoplePicker } from "@/components/PeoplePicker";

import { BlockView } from "./BlockView";
import { itemText, RECORD_LABELS } from "./blocks";
import { RecordPicker } from "./RecordPicker";
import { STALE, queryKeys } from "@/lib/queryKeys";

const { TextArea } = Input;
const { Text } = Typography;

const CHARTS = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "pie", label: "Pie" },
  { value: "area", label: "Area" },
];

function ChartSettings({ block, onChange }: { block: DocBlock; onChange: (next: DocBlock) => void }) {
  const catalogue = useQuery({
    queryKey: queryKeys.explorerCatalogue(),
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: STALE.long,
  });
  const datasets = catalogue.data?.items ?? [];
  const dataset = datasets.find((item) => item.key === block.entity);
  const groupable = (dataset?.fields ?? []).filter(
    (field) => field.facet || field.kind === "datetime" || field.kind === "enum",
  );
  return (
    <Space wrap className="nx-dc-settings">
      <Select
        aria-label="Dataset"
        placeholder="Dataset"
        style={{ minWidth: 160 }}
        loading={catalogue.isLoading}
        value={block.entity || undefined}
        options={datasets.map((item) => ({ value: item.key, label: item.label }))}
        onChange={(entity: string) => onChange({ ...block, entity, dimension: undefined })}
      />
      <Select
        aria-label="Group by"
        placeholder="Group by"
        style={{ minWidth: 160 }}
        disabled={!dataset}
        value={block.dimension || undefined}
        options={groupable.map((field) => ({ value: field.name, label: field.label }))}
        onChange={(dimension: string) =>
          onChange({ ...block, dimension, granularity: dataset?.fields.find((f) => f.name === dimension)?.kind === "datetime" ? "month" : "" })
        }
      />
      <Segmented
        aria-label="Chart type"
        value={block.chart ?? "bar"}
        options={CHARTS}
        onChange={(chart) => onChange({ ...block, chart: String(chart) })}
      />
    </Space>
  );
}

function ReportSettings({ block, onChange }: { block: DocBlock; onChange: (next: DocBlock) => void }) {
  const reports = useQuery({ queryKey: queryKeys.reports(), queryFn: ({ signal }) => reportsApi.list(signal), staleTime: STALE.minute });
  return (
    <Space wrap className="nx-dc-settings">
      <Select
        aria-label="Saved report"
        placeholder="Pick a saved report"
        showSearch
        optionFilterProp="label"
        style={{ minWidth: 240 }}
        loading={reports.isLoading}
        value={block.report_id || undefined}
        options={(reports.data?.items ?? []).map((item) => ({ value: item.id, label: item.name }))}
        onChange={(report_id: string) => onChange({ ...block, report_id })}
      />
      <Segmented
        aria-label="Show"
        value={block.show ?? "chart"}
        options={[
          { value: "chart", label: "Chart" },
          { value: "table", label: "Numbers" },
          { value: "both", label: "Both" },
        ]}
        onChange={(show) => onChange({ ...block, show: show as DocBlock["show"] })}
      />
    </Space>
  );
}

function ImageSettings({ block, onChange }: { block: DocBlock; onChange: (next: DocBlock) => void }) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Space direction="vertical" className="nu-block">
      <Upload
        accept="image/*"
        showUploadList={false}
        customRequest={async ({ file }) => {
          const picked = file as File;
          setBusy(true);
          try {
            const ticket = await filesApi.beginUpload({ name: picked.name, size_bytes: picked.size, mime_type: picked.type });
            await putBytes(ticket, picked, () => undefined);
            const stored = await filesApi.confirmUpload(ticket.file.id);
            onChange({ ...block, file_id: stored.id });
          } catch (error) {
            message.error(error instanceof Error ? error.message : "The image was not uploaded.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Button icon={<UploadOutlined />} loading={busy}>
          {block.file_id ? "Replace image" : "Upload an image"}
        </Button>
      </Upload>
      <Input
        aria-label="Caption"
        placeholder="Caption"
        value={block.caption ?? ""}
        onChange={(event) => onChange({ ...block, caption: event.target.value })}
      />
    </Space>
  );
}

function TableEditor({ block, onChange }: { block: DocBlock; onChange: (next: DocBlock) => void }) {
  const rows = block.rows ?? [[""]];
  const width = Math.max(1, ...rows.map((row) => row.length));
  const set = (r: number, c: number, value: string) =>
    onChange({ ...block, rows: rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : row)) });
  return (
    <div className="nx-dc-table-edit">
      <table className="nx-dc-table">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {Array.from({ length: width }, (_, c) => (
                <td key={c}>
                  <Input
                    size="small"
                    variant="borderless"
                    aria-label={`Row ${r + 1}, column ${c + 1}`}
                    value={row[c] ?? ""}
                    onChange={(event) => set(r, c, event.target.value)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Space wrap>
        <Button icon={<PlusOutlined />} onClick={() => onChange({ ...block, rows: [...rows, Array(width).fill("")] })}>
          Row
        </Button>
        <Button icon={<PlusOutlined />} onClick={() => onChange({ ...block, rows: rows.map((row) => [...row, ""]) })}>
          Column
        </Button>
        {rows.length > 1 && (
          <Button onClick={() => onChange({ ...block, rows: rows.slice(0, -1) })}>
            Remove last row
          </Button>
        )}
        {width > 1 && (
          <Button onClick={() => onChange({ ...block, rows: rows.map((row) => row.slice(0, width - 1)) })}>
            Remove last column
          </Button>
        )}
        <Space size={6}>
          <Switch size="small" checked={block.header !== false} onChange={(header) => onChange({ ...block, header })} aria-label="Header row" />
          <Text type="secondary">Header row</Text>
        </Space>
      </Space>
    </div>
  );
}

export function BlockEditor({ block, onChange }: { block: DocBlock; onChange: (next: DocBlock) => void }) {
  const [picking, setPicking] = useState(false);
  switch (block.kind) {
    case "heading":
      return (
        <Space.Compact className="nu-block">
          <Select
            aria-label="Heading level"
            value={block.level ?? 2}
            style={{ width: 84 }}
            options={[1, 2, 3].map((level) => ({ value: level, label: `H${level}` }))}
            onChange={(level: number) => onChange({ ...block, level })}
          />
          <Input
            aria-label="Heading"
            className={`nx-dc-h-input is-${block.level ?? 2}`}
            placeholder="Section title"
            value={block.text ?? ""}
            onChange={(event) => onChange({ ...block, text: event.target.value })}
          />
        </Space.Compact>
      );
    case "text":
    case "quote":
      return (
        <TextArea
          aria-label={block.kind === "text" ? "Text" : "Quote"}
          autoSize={{ minRows: 2 }}
          placeholder={block.kind === "text" ? "Write something — **bold**, *italic*, `code`, [link](https://…)" : "Somebody else's words"}
          value={block.text ?? ""}
          onChange={(event) => onChange({ ...block, text: event.target.value })}
        />
      );
    case "callout":
      return (
        <Space direction="vertical" className="nu-block">
          <Segmented
            aria-label="Tone"
            value={block.tone ?? "info"}
            options={[
              { value: "info", label: "Note" },
              { value: "success", label: "Good" },
              { value: "warning", label: "Careful" },
              { value: "danger", label: "Danger" },
            ]}
            onChange={(tone) => onChange({ ...block, tone: tone as DocBlock["tone"] })}
          />
          <TextArea
            aria-label="Callout"
            autoSize={{ minRows: 2 }}
            value={block.text ?? ""}
            onChange={(event) => onChange({ ...block, text: event.target.value })}
          />
        </Space>
      );
    case "code":
      return (
        <Space direction="vertical" className="nu-block">
          <Input
            aria-label="Language"
            placeholder="Language (bash, sql, python…)"
            style={{ maxWidth: 240 }}
            value={block.language ?? ""}
            onChange={(event) => onChange({ ...block, language: event.target.value })}
          />
          <TextArea
            aria-label="Code"
            className="nx-dc-mono"
            autoSize={{ minRows: 3 }}
            value={block.text ?? ""}
            onChange={(event) => onChange({ ...block, text: event.target.value })}
          />
        </Space>
      );
    case "list":
      return (
        <Space direction="vertical" className="nu-block">
          <Space size={6}>
            <Switch size="small" checked={Boolean(block.ordered)} onChange={(ordered) => onChange({ ...block, ordered })} aria-label="Numbered" />
            <Text type="secondary">Numbered</Text>
          </Space>
          <TextArea
            aria-label="List items"
            autoSize={{ minRows: 2 }}
            placeholder="One item per line"
            value={(block.items ?? []).map(itemText).join("\n")}
            onChange={(event) => onChange({ ...block, items: event.target.value.split("\n") })}
          />
        </Space>
      );
    case "checklist": {
      const items = (block.items ?? []).map((item) => (typeof item === "string" ? { text: item, done: false } : item));
      const set = (index: number, next: { text: string; done: boolean } | null) =>
        onChange({
          ...block,
          items: next === null ? items.filter((_, i) => i !== index) : items.map((item, i) => (i === index ? next : item)),
        });
      return (
        <div className="nx-dc-check-edit">
          {items.map((item, index) => (
            <div key={index} className="nx-dc-check-row">
              <Checkbox checked={item.done} onChange={(event) => set(index, { ...item, done: event.target.checked })} aria-label={`Done ${index + 1}`} />
              <Input
                variant="borderless"
                aria-label={`Checklist item ${index + 1}`}
                value={item.text}
                placeholder="Something to do"
                onChange={(event) => set(index, { ...item, text: event.target.value })}
              />
              <Button type="text" icon={<DeleteOutlined />} aria-label={`Remove item ${index + 1}`} onClick={() => set(index, null)} />
            </div>
          ))}
          <Button icon={<PlusOutlined />} onClick={() => onChange({ ...block, items: [...items, { text: "", done: false }] })}>
            Add an item
          </Button>
        </div>
      );
    }
    case "table":
      return <TableEditor block={block} onChange={onChange} />;
    case "image":
      return (
        <>
          <ImageSettings block={block} onChange={onChange} />
          {block.file_id && <BlockView block={block} tasks={{}} people={{}} />}
        </>
      );
    case "chart":
      return (
        <>
          <ChartSettings block={block} onChange={onChange} />
          <BlockView block={block} tasks={{}} people={{}} />
        </>
      );
    case "report":
      return (
        <>
          <ReportSettings block={block} onChange={onChange} />
          {block.report_id && <BlockView block={block} tasks={{}} people={{}} />}
        </>
      );
    case "record":
      return (
        <Space wrap>
          {block.resource_id ? (
            <Text>
              <Text type="secondary">{RECORD_LABELS[block.resource_type ?? ""] ?? block.resource_type}:</Text> {block.label}
            </Text>
          ) : (
            <Text type="secondary">No record chosen yet.</Text>
          )}
          <Button onClick={() => setPicking(true)} data-testid="pick-record">
            {block.resource_id ? "Change" : "Choose a record"}
          </Button>
          <RecordPicker
            open={picking}
            onClose={() => setPicking(false)}
            onPick={(record) => {
              setPicking(false);
              onChange({ ...block, resource_type: record.resource_type, resource_id: record.id, label: record.label });
            }}
          />
        </Space>
      );
    case "action":
      return (
        <div className="nx-dc-action-edit">
          <Input
            aria-label="Action item"
            placeholder="What needs doing"
            value={block.text ?? ""}
            disabled={Boolean(block.task_id)}
            onChange={(event) => onChange({ ...block, text: event.target.value })}
          />
          <PeoplePicker
            multiple={false}
            value={block.assignee_id ? [block.assignee_id] : []}
            onChange={(ids) => onChange({ ...block, assignee_id: ids[ids.length - 1] ?? null })}
            placeholder="Who"
            aria-label="Assignee"
            disabled={Boolean(block.task_id)}
          />
          <DatePicker
            aria-label="Due date"
            placeholder="Due"
            value={block.due_date ? dayjs(block.due_date) : null}
            disabled={Boolean(block.task_id)}
            onChange={(value) => onChange({ ...block, due_date: value ? value.format("YYYY-MM-DD") : null })}
          />
          {block.task_id && <Text type="secondary">Already a task — change it there.</Text>}
        </div>
      );
    default:
      return null;
  }
}
