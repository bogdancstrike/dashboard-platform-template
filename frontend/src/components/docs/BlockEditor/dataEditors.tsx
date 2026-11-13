import { Button, DatePicker, Input, Space, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";

import { PeoplePicker } from "@/components/PeoplePicker";

import { BlockView } from "../BlockView";
import { RECORD_LABELS } from "../blocks";
import { RecordPicker } from "../RecordPicker";

import { ChartSettings, ReportSettings } from "./DataBlockSettings";
import { ImageSettings } from "./ImageSettings";

const { Text } = Typography;

/** Editors for the blocks that point at something: images, charts, reports, records and actions. */

import type { EditorProps } from "./registry";

export function ImageBlockEditor({ block, onChange }: EditorProps) {
  return (
    <>
      <ImageSettings block={block} onChange={onChange} />
      {block.file_id && <BlockView block={block} tasks={{}} people={{}} />}
    </>
  );
}

export function ChartBlockEditor({ block, onChange }: EditorProps) {
  return (
    <>
      <ChartSettings block={block} onChange={onChange} />
      <BlockView block={block} tasks={{}} people={{}} />
    </>
  );
}

export function ReportBlockEditor({ block, onChange }: EditorProps) {
  return (
    <>
      <ReportSettings block={block} onChange={onChange} />
      {block.report_id && <BlockView block={block} tasks={{}} people={{}} />}
    </>
  );
}

export function RecordBlockEditor({ block, onChange }: EditorProps) {
  const [picking, setPicking] = useState(false);
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
}

export function ActionEditor({ block, onChange }: EditorProps) {
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
}
