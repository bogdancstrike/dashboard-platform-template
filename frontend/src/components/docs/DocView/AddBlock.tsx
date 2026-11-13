import { Button, Dropdown } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { type DocBlockKind } from "@/api/docs";

import { DOC_BLOCK_ORDER, DOC_BLOCKS } from "../blocks";

export function AddBlock({ onAdd, label = "Add a block" }: { onAdd: (kind: DocBlockKind) => void; label?: string }) {
  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        items: DOC_BLOCK_ORDER.map((kind) => ({
          key: kind,
          icon: DOC_BLOCKS[kind].icon,
          label: (
            <span className="nx-dc-add-item">
              <strong>{DOC_BLOCKS[kind].label}</strong>
              <span>{DOC_BLOCKS[kind].hint}</span>
            </span>
          ),
        })),
        onClick: ({ key }) => onAdd(key as DocBlockKind),
      }}
    >
      <Button icon={<PlusOutlined />} className="nx-dc-add" data-testid="add-block">
        {label}
      </Button>
    </Dropdown>
  );
}
