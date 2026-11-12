import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";

import { PersonAvatar } from "@/components/PersonAvatar";
import { StatusTag } from "@/components/StatusTag";

interface Row {
  id: string;
  name: string;
  email: string;
  initials: string;
  status: string;
  lastSeen: string;
}

const ROWS: Row[] = [
  { id: "1", name: "Ada Administrator", email: "ada@nucleus.example", initials: "AA", status: "ACTIVE", lastSeen: "just now" },
  { id: "2", name: "Mara Manager", email: "mara@nucleus.example", initials: "MM", status: "ACTIVE", lastSeen: "10 min" },
  { id: "3", name: "Priya Shah", email: "priya@nucleus.example", initials: "PS", status: "INVITED", lastSeen: "—" },
  { id: "4", name: "Lars Holm", email: "lars@nucleus.example", initials: "LH", status: "SUSPENDED", lastSeen: "3 days" },
];

const COLUMNS: ColumnsType<Row> = [
  {
    title: "Person",
    dataIndex: "name",
    sorter: (a, b) => a.name.localeCompare(b.name),
    render: (name: string, row) => (
      <span className="nx-doc-row nx-doc-row--tight">
        <PersonAvatar initials={row.initials} size="small" />
        <span className="nx-ad-main">
          <span>{name}</span>
          <span>{row.email}</span>
        </span>
      </span>
    ),
  },
  { title: "Status", dataIndex: "status", width: 140, render: (value: string) => <StatusTag status={value} /> },
  { title: "Last active", dataIndex: "lastSeen", width: 120 },
];

export default function TableGlassRows() {
  return (
    <div className="nx-ad nx-doc-flat">
      <div className="nx-ad-panel">
        <Table<Row> rowKey="id" size="small" columns={COLUMNS} dataSource={ROWS} pagination={false} scroll={{ x: 560 }} />
      </div>
    </div>
  );
}
