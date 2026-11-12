import { Card, Descriptions } from "antd";
import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { StatusTag } from "@/components/StatusTag";

const QUEUE = [
  { id: "TIC-00041", title: "Printer on fire", status: "OPEN" },
  { id: "TIC-00042", title: "Export finishes empty", status: "IN_PROGRESS" },
  { id: "TIC-00043", title: "Login loops on Safari", status: "BLOCKED" },
];

export default function SplitViewTemplate() {
  const [open, setOpen] = useState(QUEUE[0]!.id);
  const current = QUEUE.find((row) => row.id === open)!;
  return (
    <div className="nx-ad">
      <PageHeader title="Ticket console" subtitle="Work the queue without losing your place" />
      <div className="nx-doc-split">
        <Card size="small" title="Queue">
          <div className="nx-doc-col">
            {QUEUE.map((row) => (
              <button key={row.id} type="button" className={`nx-doc-qrow${row.id === open ? " is-on" : ""}`} aria-pressed={row.id === open} onClick={() => setOpen(row.id)}>
                <code>{row.id}</code> {row.title}
              </button>
            ))}
          </div>
        </Card>
        <Card title={current.title} extra={<StatusTag status={current.status} />}>
          <Descriptions column={1} size="small" items={[{ key: "r", label: "Reference", children: current.id }, { key: "c", label: "Channel", children: "Portal" }]} />
        </Card>
      </div>
    </div>
  );
}
