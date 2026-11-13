import { Button, Card, List, Space, Tag, Typography } from "antd";
import { ApartmentOutlined, ExportOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { type HubRecord } from "@/api/relationships";

const { Text } = Typography;

/** The records with the most links: explore from one, or open it. */
export function HubRecords({
  hubs,
  onStart,
}: {
  hubs: HubRecord[];
  onStart: (resourceType: string, id: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <Card size="small" title="Most connected records" data-testid="hub-records">
      <List
        grid={{ gutter: 12, xs: 1, sm: 2, lg: 3, xxl: 4 }}
        dataSource={hubs.slice(0, 12)}
        locale={{ emptyText: "Nothing links to anything yet." }}
        renderItem={(hub: HubRecord) => (
          <List.Item>
            <Card size="small" className="nu-hub" hoverable>
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                <Space size={6} wrap>
                  <Tag color="blue">{hub.connections.toLocaleString()} links</Tag>
                  <Text type="secondary">{hub.via_label}</Text>
                </Space>
                <Text strong ellipsis>
                  {hub.label}
                </Text>
                {hub.summary && (
                  <Text type="secondary" ellipsis>
                    {hub.summary}
                  </Text>
                )}
                <Space size={4}>
                  <Button
                    size="small"
                    type="text"
                    icon={<ApartmentOutlined />}
                    onClick={() => onStart(hub.resource_type, hub.id)}
                  >
                    Explore
                  </Button>
                  {hub.explorable && (
                    <Button
                      size="small"
                      type="text"
                      icon={<ExportOutlined />}
                      onClick={() => navigate(`/${hub.resource_type}s/${hub.id}`)}
                    >
                      Open
                    </Button>
                  )}
                </Space>
              </Space>
            </Card>
          </List.Item>
        )}
      />
    </Card>
  );
}
