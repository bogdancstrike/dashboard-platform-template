import { Form, Input, Modal } from "antd";

import type { ReportDocument } from "@/api/reportDocuments";

/** The document itself: its name and what it is for. */
export function SettingsDialog({
  open,
  document,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  document: ReportDocument | undefined;
  saving: boolean;
  onClose: () => void;
  onSave: (input: { name: string; description: string | null }) => void;
}) {
  const [form] = Form.useForm();
  if (!document) return null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      destroyOnHidden
      title={`Settings — ${document.name}`}
      okText="Save"
      confirmLoading={saving}
      onOk={() => void form.submit()}
      okButtonProps={{ "data-testid": "save-settings" }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ name: document.name, description: document.description ?? "" }}
        onFinish={(values: { name: string; description?: string }) =>
          onSave({ name: values.name, description: values.description || null })
        }
      >
        <Form.Item
          name="name"
          label="Name"
          extra="Also the title on the cover and the name of the file."
          rules={[{ required: true, message: "Give it a name" }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="description" label="What it is for">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
