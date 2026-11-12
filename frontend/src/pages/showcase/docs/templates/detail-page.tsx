import { Button, Card, Col, Descriptions, Row, Tabs } from "antd";

import { PageHeader } from "@/components/PageHeader";
import { StatusTag } from "@/components/StatusTag";

export default function DetailPageTemplate() {
  return (
    <div className="nx-ad">
      <PageHeader
        title="TIC-00041 · Printer on fire"
        tag={<StatusTag status="IN_PROGRESS" />}
        subtitle="Raised by Lars Holm via the portal · SLA breaches in 40 min"
        onBack={() => undefined}
        actions={
          <>
            <Button>Assign to me</Button>
            <Button type="primary">Resolve</Button>
          </>
        }
      />
      <Row gutter={[14, 14]}>
        <Col xs={24} lg={16}>
          <Card>
            <Tabs
              items={[
                { key: "conv", label: "Conversation", children: "The thread, newest last, with a reply box." },
                { key: "history", label: "History", children: "Every change, with who made it." },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="Triage">
            <Descriptions
              column={1}
              size="small"
              items={[
                { key: "s", label: "Severity", children: "Critical" },
                { key: "p", label: "Priority", children: "High" },
                { key: "a", label: "Assignee", children: "Unassigned" },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
