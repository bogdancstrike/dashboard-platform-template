import { Alert, Card, Space, Typography } from "antd";
import { ApartmentOutlined } from "@ant-design/icons";

import type { OrgCatalogue, OrgTree } from "@/api/organizations";
import { EmptyState } from "@/components/EmptyState";

import { Branch } from "./Branch";
import { OrgSummary } from "./OrgSummary";

const { Text } = Typography;

/** One organisation: its own details, its unplaced people, and its tree. */
export function Structure({
  tree,
  catalogue,
  canManage,
  onAdd,
  onMove,
  onRemove,
  busy,
}: {
  tree: OrgTree;
  catalogue: OrgCatalogue;
  canManage: boolean;
  onAdd: (parentId: string | null) => void;
  onMove: (id: string, parentId: string | null) => void;
  onRemove: (id: string) => void;
  busy: boolean;
}) {
  const org = tree.organization;
  const full = tree.depth >= tree.max_depth;

  return (
    <Space direction="vertical" size={12} className="nu-block">
      <OrgSummary org={org} />

      {/* The reason a tree can sum to less than the tenant's total, on the
          screen rather than left as a discrepancy (§34). */}
      {(tree.unassigned_people > 0 || tree.unplaced_teams.length > 0) && <Unplaced tree={tree} />}

      {full && (
        <Alert
          type="warning"
          showIcon
          data-testid="depth-reached"
          message={`The structure is ${tree.max_depth} levels deep, which is as far as it goes`}
          description="Past that the indentation runs out of room before the data runs out of depth."
        />
      )}

      <Card
        size="small"
        title={
          <Space size={6}>
            <ApartmentOutlined /> Structure
            <Text type="secondary">
              ({tree.depth + 1} {tree.depth === 0 ? "level" : "levels"})
            </Text>
          </Space>
        }
        data-testid="org-tree"
      >
        {tree.departments.length === 0 ? (
          <EmptyState compact title="No departments yet." />
        ) : (
          <ul className="nu-orgtree" role="tree" aria-label="Department structure">
            {tree.departments.map((node) => (
              <Branch
                key={node.id}
                node={node}
                all={tree.departments}
                maxDepth={tree.max_depth}
                canManage={canManage}
                busy={busy}
                onAdd={onAdd}
                onMove={onMove}
                onRemove={onRemove}
              />
            ))}
          </ul>
        )}
        {catalogue.regions.length > 0 && (
          <Text type="secondary" className="nu-orgregions">
            {catalogue.regions.length} regions configured:{" "}
            {catalogue.regions.map((region) => region.code).join(", ")}
          </Text>
        )}
      </Card>
    </Space>
  );
}


/** The reason a tree can sum to less than the tenant's total, on the screen. */
function Unplaced({ tree }: { tree: OrgTree }) {
  return (
    <Alert
      type="info"
      showIcon
      data-testid="unplaced"
      message="Not everything sits in a department"
      description={
        [
          tree.unassigned_people > 0
            ? `${tree.unassigned_people} ${tree.unassigned_people === 1 ? "person is" : "people are"} in no department`
            : null,
          tree.unplaced_teams.length > 0
            ? `${tree.unplaced_teams.length} ${tree.unplaced_teams.length === 1 ? "team" : "teams"} belong to no department: ${tree.unplaced_teams.map((team) => team.name).join(", ")}`
            : null,
        ]
          .filter(Boolean)
          .join(". ") + "."
      }
    />
  );
}
