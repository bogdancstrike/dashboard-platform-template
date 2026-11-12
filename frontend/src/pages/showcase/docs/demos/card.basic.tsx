import { Card, Typography } from "antd";

const { Text } = Typography;

export default function CardBasic() {
  return (
    <div className="nx-doc-row">
      <Card title="Pipeline" extra={<a href="#pipeline">Open</a>} style={{ flex: 1 }}>
        <Text type="secondary">A Card is a glass panel: radius 28, frosted, with a quiet title.</Text>
      </Card>
      <Card title="With an inner card" style={{ flex: 1 }}>
        <Card type="inner" size="small" title="Inner">
          Nested cards drop the glass and become a soft fill.
        </Card>
      </Card>
    </div>
  );
}
