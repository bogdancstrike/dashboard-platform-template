import { useMutation } from "@tanstack/react-query";
import { App as AntApp, Form, Input, Modal } from "antd";

import { docsApi, type DocSpace } from "@/api/docs";
import { apiMessageToast } from "@/lib/errors";

export function NewSpaceModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (space: DocSpace) => void }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<{ name: string; description: string; icon: string }>();
  const create = useMutation({
    mutationFn: (values: { name: string; description: string; icon: string }) => docsApi.createSpace(values),
    onSuccess: (space) => {
      form.resetFields();
      onCreated(space);
    },
    onError: apiMessageToast(message, "The space was not created."),
  });
  return (
    <Modal open={open} title="New space" okText="Create space" onCancel={onClose} onOk={() => form.submit()} confirmLoading={create.isPending} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(values) => create.mutate(values)}>
        <Form.Item name="name" label="Name" rules={[{ required: true, message: "A space needs a name." }]}>
          <Input maxLength={120} aria-label="Space name" />
        </Form.Item>
        <Form.Item name="icon" label="Icon">
          <Input maxLength={4} placeholder="📚" aria-label="Space icon" style={{ width: 90 }} />
        </Form.Item>
        <Form.Item name="description" label="What it is for">
          <Input.TextArea maxLength={400} autoSize={{ minRows: 2 }} aria-label="Space description" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
