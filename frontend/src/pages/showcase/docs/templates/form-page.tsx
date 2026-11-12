import { Button, Card, Col, DatePicker, Form, Input, Row, Select } from "antd";

import { PageHeader } from "@/components/PageHeader";

export default function FormPageTemplate() {
  return (
    <div className="nx-ad">
      <PageHeader title="New project" subtitle="Everything else can be filled in later" onBack={() => undefined} />
      <Card>
        <Form layout="vertical" requiredMark={false}>
          <Row gutter={14}>
            <Col xs={24} md={12}>
              <Form.Item label="Name" name="name" rules={[{ required: true, message: "A project needs a name" }]}>
                <Input placeholder="Self-service portal" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Phase" name="phase" initialValue="discovery">
                <Select options={["discovery", "design", "build", "rollout"].map((value) => ({ value, label: value }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Due" name="due">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit">Create project</Button>
        </Form>
      </Card>
    </div>
  );
}
