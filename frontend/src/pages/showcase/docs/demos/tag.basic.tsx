import { Tag } from "antd";
import { CheckCircleOutlined, SyncOutlined } from "@ant-design/icons";

export default function TagBasic() {
  return (
    <div className="nx-doc-row">
      <Tag>default</Tag>
      <Tag color="blue">blue</Tag>
      <Tag color="success" icon={<CheckCircleOutlined />}>
        success
      </Tag>
      <Tag color="processing" icon={<SyncOutlined spin />}>
        running
      </Tag>
      <Tag color="warning">warning</Tag>
      <Tag color="error">error</Tag>
      <Tag closable onClose={(event) => event.preventDefault()}>
        closable
      </Tag>
    </div>
  );
}
