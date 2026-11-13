import { Button, Card, List, Space, Tag, Tooltip, Typography } from "antd";
import { ApartmentOutlined, LoginOutlined, LogoutOutlined } from "@ant-design/icons";
import { relationColumn } from "./trail";

import type { RelationshipExplorerModel } from "./useRelationshipExplorer";

const { Text } = Typography;

/** The record's neighbours, grouped by relation — each a step further along the trail. */
export function RelationList({ m }: { m: RelationshipExplorerModel }) {
  const { navigate, id, graph, open } = m;
  const data = graph.data!;
  return (
    <div className="nu-relations">
      {data.groups.map((group) => (
        <Card
          key={`${group.direction}:${group.relation}`}
          size="small"
          className="nu-relation-group"
          title={
            <Space>
              <Tooltip
                title={
                  group.direction === "outbound"
                    ? "This record points at it"
                    : "It points at this record"
                }
              >
                {group.direction === "outbound" ? <LogoutOutlined /> : <LoginOutlined />}
              </Tooltip>
              <span>{group.label}</span>
              <Tag>{group.total}</Tag>
            </Space>
          }
          extra={
            group.has_more && (
              <Button
                type="text"
                onClick={() =>
                  navigate(
                    `/explore?resource=${group.target}&f.${relationColumn(group.relation)}=${id}`,
                  )
                }
              >
                See all {group.total}
              </Button>
            )
          }
        >
          <List
            dataSource={group.items}
            renderItem={(node) => (
              <List.Item
                className="nu-relation-item"
                actions={
                  node.explorable
                    ? [
                        <Button
                          key="open"
                          type="text"
                          icon={<ApartmentOutlined />}
                          onClick={() => open(node, group.target)}
                        >
                          Follow
                        </Button>,
                      ]
                    : []
                }
              >
                <List.Item.Meta
                  title={node.label}
                  description={node.summary || <Text type="secondary">{group.target}</Text>}
                />
              </List.Item>
            )}
          />
        </Card>
      ))}
    </div>
  );
}
