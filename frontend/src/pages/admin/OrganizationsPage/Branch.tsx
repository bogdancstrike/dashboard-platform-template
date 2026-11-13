import { Button, Popconfirm, Select, Space, Tag, Tooltip, Typography } from "antd";
import { DeleteOutlined, PlusOutlined, TeamOutlined } from "@ant-design/icons";

import type { DepartmentNode } from "@/api/organizations";
import { PersonAvatar } from "@/components/PersonAvatar";

import { movableInto, peopleLabel } from "./orgTree";

const { Text } = Typography;

interface BranchHandlers {
  onAdd: (parentId: string | null) => void;
  onMove: (id: string, parentId: string | null) => void;
  onRemove: (id: string) => void;
}

/** One department and everything under it. */
export function Branch({
  node,
  all,
  maxDepth,
  canManage,
  busy,
  onAdd,
  onMove,
  onRemove,
}: {
  node: DepartmentNode;
  all: DepartmentNode[];
  maxDepth: number;
  canManage: boolean;
  busy: boolean;
  onAdd: (parentId: string | null) => void;
  onMove: (id: string, parentId: string | null) => void;
  onRemove: (id: string) => void;
}) {
  const destinations = canManage ? movableInto(all, node.id, maxDepth) : [];

  return (
    <li role="treeitem" aria-expanded={node.children.length > 0 || undefined}>
      <div className="nu-orgnode" data-testid={`dept-${node.code}`}>
        <span className="nu-orgnode-what">
          <Text strong>{node.name}</Text>
          <Text type="secondary" className="nu-orgnode-code">
            {node.code}
            {node.cost_center ? ` · ${node.cost_center}` : ""}
          </Text>
        </span>

        {/* Two numbers, labelled — see `peopleLabel`. */}
        <Text type="secondary" className="nu-orgnode-people">
          {peopleLabel(node)}
        </Text>

        {node.manager && (
          <span className="nu-orgnode-manager">
            <PersonAvatar
              size={20}
              name={node.manager.full_name}
              initials={node.manager.initials}
              src={node.manager.avatar_url}
            />
            <Text type="secondary">{node.manager.full_name}</Text>
          </span>
        )}

        {node.teams.length > 0 && <TeamTags teams={node.teams} />}

        {canManage && <BranchActions node={node} maxDepth={maxDepth} busy={busy} destinations={destinations} onAdd={onAdd} onMove={onMove} onRemove={onRemove} />}
      </div>

      {node.children.length > 0 && (
        <ul role="group">
          {node.children.map((child) => (
            <Branch
              key={child.id}
              node={child}
              all={all}
              maxDepth={maxDepth}
              canManage={canManage}
              busy={busy}
              onAdd={onAdd}
              onMove={onMove}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Add inside, move and retire: one department's controls for a manager. */
function BranchActions({
  node,
  maxDepth,
  busy,
  destinations,
  onAdd,
  onMove,
  onRemove,
}: BranchHandlers & {
  node: DepartmentNode;
  maxDepth: number;
  busy: boolean;
  destinations: Array<{ id: string; label: string; depth: number }>;
}) {
  return (
    <Space size={2} className="nu-orgnode-acts">
      {node.depth < maxDepth - 1 && (
        <Tooltip title="Add a department inside this one">
          <Button
            type="text"
            icon={<PlusOutlined />}
            aria-label={`Add inside ${node.name}`}
            data-testid={`add-in-${node.code}`}
            onClick={() => onAdd(node.id)}
          />
        </Tooltip>
      )}
      <Select
        size="small"
        aria-label={`Move ${node.name}`}
        value={node.parent_id ?? "root"}
        disabled={busy}
        style={{ width: 150 }}
        data-testid={`move-${node.code}`}
        onChange={(next) => onMove(node.id, next === "root" ? null : next)}
        options={[
          { value: "root", label: "At the top" },
          // Its own subtree is pruned rather than offered and refused:
          // a control that produces an error on purpose is not a control.
          ...destinations.map((item) => ({
            value: item.id,
            label: `${"— ".repeat(item.depth)}${item.label}`,
          })),
        ]}
      />
      <Popconfirm
        title={`Retire ${node.name}?`}
        description={
          node.people_in_subtree > 0 || node.teams.length > 0 || node.children.length > 0
            ? "It still has people, teams or sub-departments in it — this will be refused until they are moved."
            : "Nothing is in it, so nothing else changes."
        }
        okText="Retire it"
        okButtonProps={{ danger: true }}
        onConfirm={() => onRemove(node.id)}
      >
        {/* No Tooltip around this one. A Tooltip inside a Popconfirm
            renders a *second* popover that sits over the confirmation
            and intercepts the click — the same mistake the jobs table
            made, found the same way. The button's accessible name and
            the confirmation's own title already say "Retire", so the
            hint was a third copy of the word as well as a bug. */}
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          aria-label={`Retire ${node.name}`}
          data-testid={`retire-${node.code}`}
        />
      </Popconfirm>
    </Space>
  );
}

function TeamTags({ teams }: { teams: DepartmentNode["teams"] }) {
  return (
    <Space size={[4, 4]} wrap className="nu-orgnode-teams">
      {teams.map((team) => (
        <Tooltip
          key={team.id}
          title={team.lead ? `Led by ${team.lead.full_name}` : team.description ?? undefined}
        >
          <Tag bordered={false} icon={<TeamOutlined />}>
            {team.name}
          </Tag>
        </Tooltip>
      ))}
    </Space>
  );
}
