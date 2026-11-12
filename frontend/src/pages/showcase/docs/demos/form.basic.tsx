import { App, Button, Col, Form, Input, Row, Select } from "antd";

export default function FormBasic() {
  const { message } = App.useApp();
  return (
    <Form
      layout="vertical"
      requiredMark={false}
      onFinish={(values: { name: string }) => message.success(`${values.name} would be created`)}
    >
      <Row gutter={14}>
        <Col xs={24} md={12}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "A customer needs a name" }]}>
            <Input placeholder="Acme Logistics" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="tier" label="Tier" initialValue="standard">
            <Select options={["starter", "standard", "enterprise"].map((value) => ({ value, label: value }))} />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="notes" label="Notes" extra="Shown to everyone who can see the customer.">
        <Input.TextArea rows={2} />
      </Form.Item>
      <Button type="primary" htmlType="submit">
        Create customer
      </Button>
    </Form>
  );
}
