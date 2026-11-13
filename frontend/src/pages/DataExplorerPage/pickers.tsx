import { Button, Checkbox, Popover, Select } from "antd";
import { ColumnHeightOutlined } from "@ant-design/icons";

import { type ExplorerResource } from "@/api/explorer";

/**
 * Section the scanning modes by one field (§6).
 *
 * Offered only for fields declared as facets, because those are the ones with
 * a small enough vocabulary to be worth reading as headings — grouping a list
 * by "Title" produces one section per row.
 */
export function GroupPicker({ resource, value, onChange }: {
  resource?: ExplorerResource;
  value: string;
  onChange: (field: string) => void;
}) {
  const options = (resource?.fields ?? [])
    .filter((field) => field.facet)
    .map((field) => ({ value: field.name, label: `Group by ${field.label.toLowerCase()}` }));
  if (options.length === 0) return null;

  return (
    <Select
      allowClear
      className="nu-group-select"
      aria-label="Group results"
      data-testid="group-select"
      placeholder="No grouping"
      value={value || undefined}
      onChange={(next) => onChange(next ?? "")}
      options={options}
    />
  );
}

export function ColumnPicker({ resource, value, onChange }: {
  resource?: ExplorerResource;
  value: string[];
  onChange: (columns: string[]) => void;
}) {
  const options = resource?.fields.map((field) => ({ label: field.label, value: field.name })) ?? [];
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      title="Visible columns"
      content={
        <Checkbox.Group
          className="nu-column-picker"
          value={value}
          options={options}
          onChange={(next) => next.length && onChange(next.map(String))}
        />
      }
    >
      <Button icon={<ColumnHeightOutlined />}>Columns</Button>
    </Popover>
  );
}
