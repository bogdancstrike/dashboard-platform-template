import { Card, Table } from "antd";

import { PageHeader } from "@/components/PageHeader";

const ROWS = [
  { field: "Tier", a: "enterprise", b: "standard", differs: true },
  { field: "Accounts", a: "11", b: "11", differs: false },
  { field: "Region", a: "DACH", b: "Nordics", differs: true },
];

export default function CompareTemplate() {
  return (
    <div className="nx-ad">
      <PageHeader title={<>Compare <em>customers</em></>} subtitle="Northwind DACH · Cobalt Partners — 2 of 3 fields differ" />
      <Card className="nx-ad-panel">
        <Table
          rowKey="field"
          size="small"
          pagination={false}
          dataSource={ROWS}
          rowClassName={(row) => (row.differs ? "nx-doc-differs" : "")}
          columns={[
            { title: "Field", dataIndex: "field" },
            { title: "Northwind DACH", dataIndex: "a" },
            { title: "Cobalt Partners", dataIndex: "b" },
          ]}
        />
      </Card>
    </div>
  );
}
