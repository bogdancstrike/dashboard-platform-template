import { Alert, Button, Card, Select, Space, Typography } from "antd";

import type { ImportDetail, ImportTarget } from "@/api/imports";

import { DiscardRun } from "./DiscardRun";
import { fieldLabel } from "./importCopy";

const { Text } = Typography;

interface MappingCardProps {
  run: ImportDetail;
  target: ImportTarget | undefined;
  mapping: Record<string, string>;
  onMap: (next: Record<string, string>) => void;
  onCheck: () => void;
  checking: boolean;
  onDiscard: () => void;
}

/** One control per column of the file, with its samples, choosing the field it fills. */
export function MappingCard({ run, target, mapping, onMap, onCheck, checking, onDiscard }: MappingCardProps) {
  const fields = target?.fields ?? [];
  const taken = new Set(Object.values(mapping).filter(Boolean));
  return (
    <Card
      size="small"
      title="Which column is which field"
      className="nu-imp-mapping"
      data-testid="import-mapping"
      extra={
        <Space>
          <DiscardRun run={run} testId="discard-run" onConfirm={onDiscard} />
          <Button type="primary" data-testid="check-mapping" loading={checking} onClick={onCheck}>
            Check the rows
          </Button>
        </Space>
      }
    >
      <div className="nu-imp-columns">
        {run.detected_columns.map((column) => (
          <div className="nu-imp-column" key={column.name}>
            <div className="nu-imp-column-head">
              <Text strong>{column.name}</Text>
              {/* Two columns called `name` are told apart by what is in
                  them, not by their position. */}
              <Text type="secondary" className="nu-imp-samples">
                {column.samples.length ? column.samples.join(" · ") : "empty"}
              </Text>
            </div>
            <Select
              className="nu-imp-field"
              aria-label={`Field for ${column.name}`}
              data-testid={`map-${column.name}`}
              allowClear
              placeholder="Ignore this column"
              value={mapping[column.name] || undefined}
              // `allowClear` calls back with `undefined`, which is how a
              // column is un-mapped; the server reads an empty string as
              // "ignore this column".
              onChange={(value: string | undefined) =>
                onMap({ ...mapping, [column.name]: value ?? "" })
              }
              options={fields.map((field) => ({
                value: field.name,
                label: `${field.label}${field.required ? " *" : ""}`,
                // One field per column: the server refuses two, and
                // offering a taken field would be drawing a control the
                // endpoint rejects (§76).
                disabled:
                  taken.has(field.name) && mapping[column.name] !== field.name,
              }))}
            />
          </div>
        ))}
      </div>

      {run.unmapped_required.length ? (
        <Alert
          type="warning"
          showIcon
          className="nu-imp-missing"
          data-testid="unmapped"
          message={`Still needed: ${run.unmapped_required
            .map((name) => (target ? fieldLabel(target, name) : name))
            .join(", ")}`}
          description="Every row must have a value for these, so a column has to be chosen before anything can be imported."
        />
      ) : null}
    </Card>
  );
}
