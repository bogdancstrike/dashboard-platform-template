import { Card, Space, Table, Tag } from "antd";

import type { FeatureFlag } from "@/api/settings";
import { EmptyState } from "@/components/EmptyState";

import { flagColumns } from "./flagColumns";
import type { useFlagsPage } from "./useFlagsPage";

interface FlagGroupsProps {
  page: ReturnType<typeof useFlagsPage>;
  groups: Array<[string, FeatureFlag[]]>;
  areaLabels: Record<string, string>;
  phone: boolean;
}

/** One card per product area, each with its flags' table. */
export function FlagGroups({ page, groups, areaLabels, phone }: FlagGroupsProps) {
  const columns = flagColumns(page, phone);
  return (
    <div className="nx-ff-groups" data-testid="flags-table">
      {groups.length === 0 && (
        <Card size="small">
          <EmptyState compact title="No flag matches" />
        </Card>
      )}
      {groups.map(([area, rows]) => (
        <Card
          key={area}
          size="small"
          className="nx-ff-group"
          data-testid={`flag-group-${area}`}
          title={
            <Space size={8}>
              <span>{areaLabels[area] ?? (area === "custom" ? "Custom" : area)}</span>
              <Tag bordered={false}>
                {rows.filter((row) => row.enabled).length} of {rows.length} on
              </Tag>
            </Space>
          }
        >
          <Table<FeatureFlag>
            rowKey="key"
            size="small"
            pagination={false}
            tableLayout={phone ? "fixed" : undefined}
            columns={columns}
            dataSource={rows}
            locale={{ emptyText: <EmptyState compact title="No flag is in this state" /> }}
          />
        </Card>
      ))}
    </div>
  );
}
