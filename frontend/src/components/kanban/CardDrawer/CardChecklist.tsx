import { Button, Checkbox, Input, Space, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import type { CardDrawerModel } from "./useCardDrawer";

const { Text } = Typography;

/**
 * A checklist is a field on the card, audited with every other edit — a
 * "checklist API" would be a second set of rules about who may tick a box.
 */
export function CardChecklist({ model }: { model: CardDrawerModel }) {
  const { detail, canEdit, write, tick, step, setStep, addStep } = model;
  if (!detail) return null;
  return (
    <div data-testid="card-checklist">
      <Text strong className="nu-field-label">
        Checklist{" "}
        {detail.checklist.length > 0 && (
          <Text type="secondary">
            {detail.checklist_done} of {detail.checklist.length}
          </Text>
        )}
      </Text>
      <Space direction="vertical" size={4} style={{ width: "100%" }}>
        {detail.checklist.map((item, index) => (
          <Checkbox
            key={`${item.text}-${index}`}
            checked={item.done}
            disabled={!canEdit || write.isPending}
            onChange={(event) => tick(index, event.target.checked)}
          >
            {item.text}
          </Checkbox>
        ))}
        {canEdit && (
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={step}
              placeholder="Add a step"
              aria-label="New checklist item"
              onChange={(event) => setStep(event.target.value)}
              onPressEnter={addStep}
            />
            <Button icon={<PlusOutlined />} onClick={addStep}>
              Add
            </Button>
          </Space.Compact>
        )}
      </Space>
    </div>
  );
}
