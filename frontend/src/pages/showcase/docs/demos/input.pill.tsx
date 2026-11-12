import { Input, InputNumber } from "antd";
import { SearchOutlined, UserOutlined } from "@ant-design/icons";

export default function InputPill() {
  return (
    <div className="nx-doc-grid">
      <Input placeholder="Default" aria-label="Default" />
      <Input prefix={<SearchOutlined />} allowClear placeholder="With a prefix and clear" aria-label="Search" />
      <Input prefix={<UserOutlined />} defaultValue="ada@nucleus.example" aria-label="Email" />
      <Input status="error" defaultValue="not-an-email" aria-label="Email with an error" />
      <Input status="warning" defaultValue="almost" aria-label="With a warning" />
      <Input disabled defaultValue="Disabled" aria-label="Disabled" />
      <InputNumber addonAfter="days" defaultValue={400} min={1} aria-label="Retention" style={{ width: "100%" }} />
      <Input.Password placeholder="Password" aria-label="Password" />
      <Input.TextArea rows={2} placeholder="A longer answer" aria-label="Description" />
    </div>
  );
}
