import { Button, Tag } from "antd";

import { PageHeader } from "@/components/PageHeader";
import { StatusTag } from "@/components/StatusTag";

export default function PageHeaderDetail() {
  return (
    <PageHeader
      title="TIC-00041 · Printer on fire"
      tag={
        <>
          <StatusTag status="IN_PROGRESS" />
          <Tag>Facilities</Tag>
        </>
      }
      subtitle="Raised by Lars Holm · 2 hours ago · SLA breaches in 40 min"
      onBack={() => undefined}
      actions={<Button>Assign to me</Button>}
    />
  );
}
