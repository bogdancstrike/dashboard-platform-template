import { Button, Popconfirm, Popover, Tooltip } from "antd";

export default function OverlayTooltipPopover() {
  return (
    <div className="nx-doc-row">
      <Tooltip title="The exact time: 12 Nov 2026, 19:24:03">
        <span className="nx-doc-underline">2 min ago</span>
      </Tooltip>
      <Popover title="Where it comes from" content="Role: Manager · Groups: Platform, Ops leads">
        <Button>Popover</Button>
      </Popover>
      <Popconfirm title="Apply these permission changes?" description="Holders are affected on their next request." okText="Apply">
        <Button danger>Popconfirm</Button>
      </Popconfirm>
    </div>
  );
}
