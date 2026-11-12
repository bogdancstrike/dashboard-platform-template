import { Button, Card, Input, Select, Table } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";
import { StatusTag } from "@/components/StatusTag";

const ROWS = [
  { id: "1", name: "Northwind DACH", owner: "Mara Manager", status: "ACTIVE", value: "€402,100" },
  { id: "2", name: "Cobalt Partners", owner: "Otto Operator", status: "AT_RISK", value: "€88,400" },
  { id: "3", name: "Halcyon Solutions", owner: "Ada Administrator", status: "ACTIVE", value: "€1.2M" },
];

export default function ListPageTemplate() {
  return (
    <div className="nx-ad">
      <PageHeader
        title={<>Customer <em>accounts</em></>}
        subtitle="1,204 accounts · 18 renewals this month"
        actions={<Button type="primary" icon={<PlusOutlined />}>New account</Button>}
      />
      <div className="nx-ad-bar" role="search">
        <Input className="nx-ad-grow" prefix={<SearchOutlined />} placeholder="Search accounts" aria-label="Search accounts" />
        <Select aria-label="Owner" placeholder="Owner: anyone" style={{ minWidth: 150 }} options={[]} />
      </div>
      <Card className="nx-ad-panel">
        <Table
          rowKey="id"
          size="small"
          dataSource={ROWS}
          pagination={{ total: 1204, pageSize: 25, showTotal: (total, range) => `Showing ${range[0]}–${range[1]} of ${total}` }}
          columns={[
            { title: "Account", dataIndex: "name" },
            { title: "Owner", dataIndex: "owner" },
            { title: "Status", dataIndex: "status", render: (value: string) => <StatusTag status={value} /> },
            { title: "Value", dataIndex: "value", align: "right" },
          ]}
        />
      </Card>
    </div>
  );
}
