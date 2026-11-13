import { Button, Space, Tag, Tooltip, Typography } from "antd";
import { EyeOutlined } from "@ant-design/icons";

import type { ExplorerField, ExplorerResult } from "@/api/explorer";
import { HighlightedText } from "@/components/HighlightedText";
import { StatusTag } from "@/components/StatusTag";
import { FavoriteStar } from "@/components/records/FavoriteStar";
import { asText } from "@/lib/text";

import { ExplorerRecord } from "./index";

const { Text } = Typography;

/**
 * The star on one row.
 *
 * Named from the dataset's own title field rather than from the first column,
 * because the columns are the reader's choice and a bookmark reading "PAID"
 * helps nobody. The address is the record's own page, stored so the bookmark
 * survives both a rename and a change to the route's shape (§38).
 */
export function RowStar({
  record,
  result,
  path,
}: {
  record: ExplorerRecord;
  result: ExplorerResult | undefined;
  path: string;
}) {
  const id = String(record.id);
  const first = result?.columns?.[0];
  const label = asText(record[first ?? ""]) || id.slice(0, 8);
  return (
    <FavoriteStar
      resourceType={result?.resource_type ?? ""}
      recordId={id}
      label={label}
      url={path ? `${path}/${id}` : `/explore?resource=${result?.resource_type ?? ""}&record=${id}`}
    />
  );
}

export function PreviewButton({
  record,
  onPreview,
}: {
  record: ExplorerRecord;
  onPreview: (record: ExplorerRecord) => void;
}) {
  return (
    <Tooltip title="Preview this record">
      <Button
        type="text"
        size="small"
        icon={<EyeOutlined />}
        aria-label={`Preview ${String(record.id)}`}
        onClick={(event) => {
          // The table row opens the same preview; without this the click runs
          // twice and the drawer flickers shut.
          event.stopPropagation();
          onPreview(record);
        }}
      />
    </Tooltip>
  );
}

export function Value({
  value,
  field,
  term,
  primary = false,
}: {
  value: unknown;
  field?: ExplorerField;
  term: string;
  primary?: boolean;
}) {
  if (value === null || value === undefined || value === "") return <Text type="secondary">—</Text>;
  if (field?.kind === "bool") return <Tag color={value ? "green" : "default"}>{value ? "Yes" : "No"}</Tag>;
  // Known vocabulary (status, priority, kind…) reads as the app's one status
  // pill: sentence case, tinted, with a dot — in every view mode.
  if (field?.kind === "enum") return <StatusTag status={asText(value)} />;
  if (field?.kind === "datetime") {
    const parsed = new Date(asText(value));
    return (
      <Text className="nu-explorer-date" title={Number.isNaN(parsed.valueOf()) ? undefined : parsed.toLocaleString()}>
        {Number.isNaN(parsed.valueOf())
          ? asText(value)
          : parsed.toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              // The year only when it is not this one: it is the part a
              // reader can usually supply, and the column stays narrow.
              ...(parsed.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
              hour: "numeric",
              minute: "2-digit",
            })}
      </Text>
    );
  }
  if (Array.isArray(value)) {
    return <Space size={4} wrap>{value.map((entry) => <Tag key={asText(entry)}>{asText(entry)}</Tag>)}</Space>;
  }
  if (typeof value === "number") {
    return <Text>{value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>;
  }
  const text = <HighlightedText text={asText(value)} term={term} />;
  return primary ? <Text strong>{text}</Text> : <Text>{text}</Text>;
}
