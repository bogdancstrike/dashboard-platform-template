import { Input, InputNumber, Modal, Select, Space, Typography } from "antd";

import type { KanbanLane } from "@/api/kanban";

import type { LaneDialog } from "./LaneHeader";

const { Text } = Typography;

/** Rename, limit and remove — each seeded from the lane when it opens. */
export function LaneDialogs({
  lane,
  others,
  dialog,
  onClose,
  name,
  onName,
  limit,
  onLimit,
  destination,
  onDestination,
  onChange,
  onRemove,
}: {
  lane: KanbanLane;
  others: KanbanLane[];
  dialog: LaneDialog | null;
  onClose: () => void;
  name: string;
  onName: (name: string) => void;
  limit: number | null;
  onLimit: (limit: number | null) => void;
  destination: string;
  onDestination: (laneId: string) => void;
  onChange: (input: { name?: string; wip_limit?: number | null }) => void;
  onRemove: (moveTo?: string) => void;
}) {
  return (
    <>
      <Modal
        open={dialog === "rename"}
        title={`Rename ${lane.name}`}
        okText="Rename"
        okButtonProps={{ disabled: !name.trim() }}
        onCancel={onClose}
        onOk={() => {
          onChange({ name: name.trim() });
          onClose();
        }}
      >
        <Input
          autoFocus
          value={name}
          aria-label="Lane name"
          onChange={(event) => onName(event.target.value)}
        />
      </Modal>

      <Modal
        open={dialog === "limit"}
        title={`Work-in-progress limit for ${lane.name}`}
        okText="Save"
        onCancel={onClose}
        onOk={() => {
          onChange({ wip_limit: limit && limit > 0 ? limit : null });
          onClose();
        }}
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <InputNumber
            min={1}
            value={limit ?? undefined}
            placeholder="No limit"
            aria-label="Work-in-progress limit"
            style={{ width: "100%" }}
            onChange={(value) => onLimit(value ?? null)}
          />
          <Text type="secondary">
            A limit warns when the lane goes over it. It never stops a card moving — a board
            that argues gets worked around.
          </Text>
        </Space>
      </Modal>

      <Modal
        open={dialog === "remove"}
        title={`Remove ${lane.name}?`}
        okText="Remove the lane"
        okButtonProps={{ danger: true }}
        onCancel={onClose}
        onOk={() => {
          onRemove(destination || undefined);
          onClose();
        }}
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text>
            {lane.total > 0
              ? `${lane.total} card${lane.total === 1 ? "" : "s"} will move. Nothing is deleted.`
              : "The lane is empty."}
          </Text>
          {lane.total > 0 && (
            <Select
              aria-label="Move the cards to"
              style={{ width: "100%" }}
              value={destination || others[0]?.id}
              onChange={onDestination}
              options={others.map((item) => ({ value: item.id, label: item.name }))}
            />
          )}
        </Space>
      </Modal>
    </>
  );
}
