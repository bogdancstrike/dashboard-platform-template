import { Button, Dropdown } from "antd";
import { DeleteOutlined, DownOutlined, EditOutlined, MoreOutlined, ShareAltOutlined } from "@ant-design/icons";

const ITEMS = [
  { key: "edit", label: "Rename", icon: <EditOutlined /> },
  { key: "share", label: "Share…", icon: <ShareAltOutlined /> },
  { type: "divider" as const },
  { key: "delete", label: "Delete", icon: <DeleteOutlined />, danger: true },
];

export default function DropdownMenu() {
  return (
    <div className="nx-doc-row">
      <Dropdown menu={{ items: ITEMS }}>
        <Button>
          Actions <DownOutlined />
        </Button>
      </Dropdown>
      <Dropdown menu={{ items: ITEMS }} trigger={["click"]}>
        <Button type="text" icon={<MoreOutlined />} aria-label="More actions on this report" />
      </Dropdown>
    </div>
  );
}
