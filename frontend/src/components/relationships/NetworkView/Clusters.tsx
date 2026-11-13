import { useNavigate } from "react-router-dom";
import { Card, Space, Table, Tooltip, Typography } from "antd";

import type { Community, RecordNetwork } from "@/api/relationships";
import { NEUTRAL } from "@/theme/tokens";

import { ChosenRecord } from "./ChosenRecord";

const { Text } = Typography;

const MUTED = NEUTRAL[400];

/** The clusters, named, with what each is made of and how many links leave it; a row lights it on the graph. */
export function Clusters({
  communities,
  chosen,
  colors,
  highlighted,
  onHighlight,
  onExplore,
}: {
  communities: Community[];
  chosen: RecordNetwork["nodes"][number] | undefined;
  colors: Map<string, string>;
  highlighted: string | null;
  onHighlight: React.Dispatch<React.SetStateAction<string | null>>;
  onExplore: (entity: string, id: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <Card
      size="small"
      title="The clusters, named"
      data-testid="community-list"
      className="nu-fill-height"
    >
      {chosen && <ChosenRecord node={chosen} onExplore={onExplore} onOpen={navigate} />}
      <Table<Community>
        size="small"
        rowKey="id"
        dataSource={communities}
        pagination={false}
        scroll={{ y: chosen ? 320 : 430 }}
        onRow={(community) => ({
          onClick: () =>
            onHighlight((current) => (current === community.id ? null : community.id)),
          style: { cursor: "pointer" },
        })}
        rowClassName={(community) =>
          community.id === highlighted ? "nu-row-selected" : ""
        }
        columns={[
          {
            title: "Cluster",
            dataIndex: "label",
            render: (label: string, community) => (
              <Space size={8} align="start">
                <span
                  className="nu-swatch"
                  style={{ background: colors.get(community.id) ?? MUTED }}
                  aria-hidden
                />
                <Space direction="vertical" size={0} style={{ lineHeight: 1.3 }}>
                  {/* A button, not a label: the row highlights a cluster
                      on the graph, and a click handler on the row alone
                      is a control no keyboard can reach. It is also what
                      gives this scrolling panel focusable content, which
                      is the other half of the same rule (§55). */}
                  <button
                    type="button"
                    className="nu-row-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onHighlight((current) =>
                        current === community.id ? null : community.id,
                      );
                    }}
                  >
                    {label}
                  </button>
                  <Text type="secondary">
                    {community.mix
                      .map((part) => `${part.count} ${part.label.toLowerCase()}`)
                      .join(" · ")}
                  </Text>
                </Space>
              </Space>
            ),
          },
          {
            title: "Size",
            dataIndex: "size",
            width: 70,
            align: "right",
          },
          {
            title: "Out",
            dataIndex: "external_links",
            width: 70,
            align: "right",
            render: (value: number) => (
              <Tooltip title="Links leaving this cluster. Zero means it stands alone.">
                <Text type={value === 0 ? "secondary" : undefined}>{value}</Text>
              </Tooltip>
            ),
          },
        ]}
      />
    </Card>
  );
}
