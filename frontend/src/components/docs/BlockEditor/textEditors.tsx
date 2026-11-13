import { Button, Checkbox, Input, Segmented, Select, Space, Switch, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";

import type { DocBlock } from "@/api/docs";

import { itemText } from "../blocks";

const { TextArea } = Input;
const { Text } = Typography;

/** Editors for the blocks that are words: headings, prose, callouts, code, lists and checklists. */

import type { EditorProps } from "./registry";

export function HeadingEditor({ block, onChange }: EditorProps) {
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
}

export function ProseEditor({ block, onChange }: EditorProps) {
  return (
    <TextArea
      aria-label={block.kind === "text" ? "Text" : "Quote"}
      autoSize={{ minRows: 2 }}
      placeholder={block.kind === "text" ? "Write something — **bold**, *italic*, `code`, [link](https://…)" : "Somebody else's words"}
      value={block.text ?? ""}
      onChange={(event) => onChange({ ...block, text: event.target.value })}
    />
  );
}

export function CalloutEditor({ block, onChange }: EditorProps) {
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
}

export function CodeEditor({ block, onChange }: EditorProps) {
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
}

export function ListEditor({ block, onChange }: EditorProps) {
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
}

export function ChecklistEditor({ block, onChange }: EditorProps) {
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
