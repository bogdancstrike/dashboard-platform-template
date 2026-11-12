import { Button, Card, Form, Input, InputNumber, Select, Switch } from "antd";

import { PageHeader } from "@/components/PageHeader";

export default function SettingsTemplate() {
  return (
    <div className="nx-ad">
      <PageHeader title="Settings" subtitle="Platform-wide defaults" actions={<Button type="primary">Save changes</Button>} />
      <Card title="Organization">
        <Form layout="vertical">
          <Form.Item label="Name">
            <Input defaultValue="Northwind Ops" />
          </Form.Item>
          <Form.Item label="Default time zone">
            <Select defaultValue="Europe/Berlin" options={[{ value: "Europe/Berlin", label: "Europe/Berlin" }]} />
          </Form.Item>
        </Form>
      </Card>
      <Card title="Data retention">
        <Form layout="vertical">
          <Form.Item label="Audit log, in days" extra="Required for ISO 27001 evidence.">
            <InputNumber defaultValue={400} min={30} />
          </Form.Item>
          <Form.Item label="Self-service sign-up">
            <Switch aria-label="Self-service sign-up" />
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
