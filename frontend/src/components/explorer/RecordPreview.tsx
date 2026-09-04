/**
 * A record's full detail beside the list it came from (§64).
 *
 * The point of a preview is to answer "is this the row I want?" without losing
 * the list — going to a detail page and back costs the scroll position, the
 * page, and the reader's place in a comparison they were part-way through.
 *
 * It shows *every* declared field, not only the visible columns: the columns
 * are what somebody chose to compare across rows, and the preview is where the
 * rest of the record lives.
 */

import { App, Button, Descriptions, Drawer, Space, Tooltip, Typography } from "antd";
import { ApartmentOutlined, CopyOutlined, LinkOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import type { ExplorerField, ExplorerResult } from "@/api/explorer";
import { HighlightedText } from "@/components/HighlightedText";

const { Text } = Typography;

export interface RecordPreviewProps {
  open: boolean;
  record: (Record<string, unknown> & { id: string }) | null;
  result: ExplorerResult | undefined;
  onClose: () => void;
}

export function RecordPreview({ open, record, result, onClose }: RecordPreviewProps) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  if (!record || !result) return null;

  const fields = result.fields;
  const title = String(record[result.columns[0] ?? "id"] ?? record.id);

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(`${what} copied`);
    } catch {
      // Clipboard access is denied in some contexts; saying so beats a silent
      // no-op that looks like the button is broken.
      message.warning("Your browser would not let the page copy that");
    }
  };

  return (
    <Drawer
      open={open}
      width="min(560px, 94vw)"
      onClose={onClose}
      title={<span className="nu-preview-title">{title}</span>}
      extra={
        <Space>
          <Tooltip title="Follow this record's connections">
            <Button
              icon={<ApartmentOutlined />}
              aria-label="Show connections"
              onClick={() =>
                navigate(
                  `/find/relationships?resource=${result.resource_type}&id=${record.id}`,
                )
              }
            />
          </Tooltip>
          <Tooltip title="Copy this record's id">
            <Button
              icon={<CopyOutlined />}
              aria-label="Copy record id"
              onClick={() => void copy(record.id, "Record id")}
            />
          </Tooltip>
          <Tooltip title="Copy a link to this exact view">
            <Button
              icon={<LinkOutlined />}
              aria-label="Copy link to this view"
              onClick={() => void copy(window.location.href, "Link")}
            />
          </Tooltip>
        </Space>
      }
    >
      <Descriptions
        className="nu-preview"
        column={1}
        size="small"
        bordered
        items={fields.map((field) => ({
          key: field.name,
          label: field.label,
          children: (
            <PreviewValue
              value={record[field.name]}
              field={field}
              term={result.searchable.includes(field.name) ? result.query_text : ""}
            />
          ),
        }))}
      />
    </Drawer>
  );
}

function PreviewValue({
  value,
  field,
  term,
}: {
  value: unknown;
  field: ExplorerField;
  term: string;
}) {
  if (value === null || value === undefined || value === "") {
    // A field the record does not carry is different from one the result did
    // not ask for; both are absent here, and neither is an error.
    return <Text type="secondary">—</Text>;
  }
  if (field.kind === "datetime") {
    const parsed = new Date(String(value));
    return <Text>{Number.isNaN(parsed.valueOf()) ? String(value) : parsed.toLocaleString()}</Text>;
  }
  if (field.kind === "bool") return <Text>{value ? "Yes" : "No"}</Text>;
  return (
    <Text>
      <HighlightedText text={String(value)} term={term} />
    </Text>
  );
}
