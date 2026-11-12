import { Button, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState, type Key } from "react";

import { StatusTag } from "@/components/StatusTag";

interface Row {
  id: string;
  reference: string;
  title: string;
  status: string;
}

const ROWS: Row[] = [
  { id: "1", reference: "TIC-00041", title: "Printer on fire", status: "OPEN" },
  { id: "2", reference: "TIC-00042", title: "Export finishes empty", status: "IN_PROGRESS" },
  { id: "3", reference: "TIC-00043", title: "Login loops on Safari", status: "RESOLVED" },
  { id: "4", reference: "TIC-00044", title: "Invoice PDF is blank", status: "BLOCKED" },
];

const COLUMNS: ColumnsType<Row> = [
  { title: "Reference", dataIndex: "reference", width: 130 },
  { title: "Title", dataIndex: "title" },
  { title: "Status", dataIndex: "status", width: 140, render: (value: string) => <StatusTag status={value} /> },
];

export default function TableSelectionBulk() {
  const [selected, setSelected] = useState<Key[]>(["2", "4"]);
  return (
    <div className="nx-doc-col">
      {selected.length > 0 && (
        <div className="nx-doc-bulk" role="toolbar" aria-label="Bulk actions">
          <b>{selected.length} selected</b>
          <Button>Assign…</Button>
          <Button>Change status…</Button>
          <Button danger>Delete</Button>
          <Button type="text" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}
      <Table<Row>
        rowKey="id"
        size="small"
        columns={COLUMNS}
        dataSource={ROWS}
        pagination={false}
        scroll={{ x: 520 }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: setSelected,
          getCheckboxProps: (row) => ({ "aria-label": `Select ${row.reference}` }) as Record<string, string>,
        }}
      />
    </div>
  );
}
