import { Card, Col, Row, Table, Tag } from "antd";

import type { SignInRow, UserSessionRow } from "@/api/users";
import { relativeTime } from "@/lib/time";



export function SecurityTab({
  sessions,
  signIns,
}: {
  sessions: UserSessionRow[];
  signIns: SignInRow[];
}) {
  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={12}>
        <Card size="small" title="Sessions">
          <Table<UserSessionRow>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={sessions}
            locale={{ emptyText: "No sessions on record." }}
            columns={[
              { title: "Device", dataIndex: "device", ellipsis: true },
              { title: "Address", dataIndex: "ip_address", width: 140 },
              {
                title: "Last seen",
                dataIndex: "last_seen_at",
                width: 130,
                render: (value: string | null) => relativeTime(value),
              },
              {
                title: "",
                dataIndex: "revoked",
                width: 90,
                render: (revoked: boolean) =>
                  revoked ? <Tag>revoked</Tag> : <Tag color="green">live</Tag>,
              },
            ]}
          />
        </Card>
      </Col>
      <Col xs={24} xl={12}>
        <Card size="small" title="Recent sign-ins">
          <Table<SignInRow>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={signIns}
            locale={{ emptyText: "No sign-ins on record." }}
            columns={[
              {
                title: "Result",
                dataIndex: "result",
                width: 110,
                render: (value: string) => (
                  <Tag color={value === "SUCCESS" ? "green" : "red"}>{value}</Tag>
                ),
              },
              { title: "Address", dataIndex: "ip_address", width: 140 },
              { title: "Method", dataIndex: "method", width: 110 },
              {
                title: "When",
                dataIndex: "at",
                width: 130,
                render: (value: string | null) => relativeTime(value),
              },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}
