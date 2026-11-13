import { Button, Card, Space, Tag, Typography } from "antd";
import { ApartmentOutlined, ExportOutlined } from "@ant-design/icons";

import { type NetworkNode } from "@/api/relationships";

const { Text } = Typography;

/** The record the reader clicked, with the two things they can do with it. */
export function ChosenRecord({
  node,
  onExplore,
  onOpen,
}: {
  node: NetworkNode;
  onExplore: (entity: string, id: string) => void;
  onOpen: (path: string) => void;
}) {
  return (
    <Card size="small" className="nu-block nu-chosen" data-testid="chosen-record">
      <Space direction="vertical" size={4} style={{ width: "100%" }}>
        <Space size={6} wrap>
          <Tag>{node.entity_label}</Tag>
          {node.status && <Tag>{node.status}</Tag>}
          <Text type="secondary">{node.degree} links</Text>
        </Space>
        <Text strong>{node.label}</Text>
        {node.summary && <Text type="secondary">{node.summary}</Text>}
        <Space size={4}>
          {node.explorable && (
            <Button
              size="small"
              type="text"
              icon={<ApartmentOutlined />}
              onClick={() => onExplore(node.entity, node.id)}
            >
              Follow connections
            </Button>
          )}
          {node.explorable && (
            <Button
              size="small"
              type="text"
              icon={<ExportOutlined />}
              onClick={() => onOpen(`/${node.entity}s/${node.id}`)}
            >
              Open record
            </Button>
          )}
        </Space>
      </Space>
    </Card>
  );
}
