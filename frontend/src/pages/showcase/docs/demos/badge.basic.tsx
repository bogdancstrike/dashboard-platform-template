import { Avatar, Badge, Button } from "antd";
import { BellOutlined, MailOutlined } from "@ant-design/icons";

export default function BadgeBasic() {
  return (
    <div className="nx-doc-row">
      <Badge count={12}>
        <Button shape="circle" icon={<BellOutlined />} aria-label="Notifications, 12 unread" />
      </Badge>
      <Badge dot>
        <Button shape="circle" icon={<MailOutlined />} aria-label="Mail, something new" />
      </Badge>
      <Badge count={120} overflowCount={99}>
        <Avatar shape="square">AA</Avatar>
      </Badge>
      <Badge status="success" text="Live" />
      <Badge status="warning" text="Degraded" />
      <Badge status="error" text="Down" />
    </div>
  );
}
