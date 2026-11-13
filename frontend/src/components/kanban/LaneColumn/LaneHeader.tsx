import { Button, Dropdown, Space, Tag, Tooltip, Typography } from "antd";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";

import type { KanbanLane } from "@/api/kanban";

const { Text } = Typography;

export type LaneDialog = "rename" | "limit" | "remove";

/** The lane's name, its done mark, its count against its limit, and its menu. */
export function LaneHeader({
  lane,
  canEdit,
  others,
  onAdd,
  onChange,
  onDialog,
}: {
  lane: KanbanLane;
  canEdit: boolean;
  others: KanbanLane[];
  onAdd: () => void;
  onChange: (input: { is_done?: boolean }) => void;
  onDialog: (which: LaneDialog) => void;
}) {
  return (
    <header className="nu-lane-col-head">
      <span className="nu-lane-col-name">
        <i
          aria-hidden
          className={`nx-rec-klane-dot${lane.is_done ? " is-done" : lane.over_limit ? " is-over" : ""}`}
        />
        <Text strong>{lane.name}</Text>
        {lane.is_done && (
          <Tooltip title="Arriving here marks a card finished">
            <Tag bordered={false} color="success">
              done
            </Tag>
          </Tooltip>
        )}
      </span>

      <Space size={4}>
        <Tooltip
          title={
            lane.wip_limit === null
              ? `${lane.total} cards match`
              : `${lane.total} of a limit of ${lane.wip_limit}`
          }
        >
          {/* The server's count over the whole match, not the cards drawn. */}
          <Tag
            bordered={false}
            color={lane.over_limit ? "warning" : undefined}
            className="nu-lane-col-count"
          >
            {lane.wip_limit === null ? lane.total : `${lane.total}/${lane.wip_limit}`}
          </Tag>
        </Tooltip>

        {canEdit && (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "add", icon: <PlusOutlined />, label: "Add a card" },
                { key: "rename", label: "Rename this lane" },
                {
                  key: "limit",
                  label:
                    lane.wip_limit === null
                      ? "Set a work-in-progress limit"
                      : "Change the limit",
                },
                {
                  key: "done",
                  label: lane.is_done ? "No longer the done lane" : "Make this the done lane",
                },
                {
                  key: "remove",
                  danger: true,
                  // Says what happens to the work, because that is the
                  // question somebody is actually asking.
                  // "1 card moves" and "2 cards move": the verb agrees
                  // with the noun, which the first version did not.
                  label:
                    lane.total > 0
                      ? `Remove — ${lane.total === 1 ? "1 card moves" : `${lane.total} cards move`}`
                      : "Remove this lane",
                  disabled: others.length === 0,
                },
              ],
              onClick: ({ key }) => {
                if (key === "add") onAdd();
                else if (key === "done") onChange({ is_done: !lane.is_done });
                else onDialog(key as "rename" | "limit" | "remove");
              },
            }}
          >
            <Button
              type="text"
              size="small"
              icon={<MoreOutlined />}
              aria-label={`Actions for ${lane.name}`}
              data-testid={`lane-actions-${lane.id}`}
            />
          </Dropdown>
        )}
      </Space>
    </header>
  );
}
