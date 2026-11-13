import { useMutation } from "@tanstack/react-query";
import { App as AntApp, Form, Input, Modal } from "antd";

import { organizationsApi } from "@/api/organizations";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

interface NewDepartmentModalProps {
  /** Where it goes: `parentId` null for the top level; the modal is open while set. */
  adding: { parentId: string | null } | null;
  organizationId: string | null;
  onClose: () => void;
  onAdded: () => Promise<void>;
  onError: (error: unknown) => void;
}

/** Add a department, at the top or inside another. */
export function NewDepartmentModal({ adding, organizationId, onClose, onAdded, onError }: NewDepartmentModalProps) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const { touch, settled, requestClose } = useDiscardGuard({ close: onClose, what: "department" });

  const addDepartment = useMutation({
    mutationFn: (body: { name: string; code: string; parent_id?: string | null }) =>
      organizationsApi.addDepartment(organizationId!, body),
    onSuccess: async (created) => {
      settled();
      message.success(`${created.name} added.`);
      onClose();
      form.resetFields();
      await onAdded();
    },
    onError,
  });

  return (
    <Modal
      open={adding !== null}
      onCancel={requestClose}
      title={adding?.parentId ? "Add a sub-department" : "Add a department"}
      okText="Add it"
      confirmLoading={addDepartment.isPending}
      onOk={() => {
        void form
          .validateFields()
          .then((values: { name: string; code: string }) =>
            addDepartment.mutate({ ...values, parent_id: adding?.parentId ?? null }),
          )
          .catch(() => {
            // The form is already showing why; swallowed so an empty field
            // does not become an unhandled rejection.
          });
      }}
      okButtonProps={{ "data-testid": "create-department" }}
    >
      <Form form={form} layout="vertical" data-testid="department-form" onValuesChange={touch}>
        <Form.Item
          name="name"
          label="Name"
          rules={[{ required: true, message: "A department needs a name." }]}
        >
          <Input autoFocus maxLength={120} placeholder="Platform Engineering" aria-label="Department name" />
        </Form.Item>
        <Form.Item
          name="code"
          label="Code"
          rules={[{ required: true, message: "A department needs a code." }]}
          extra="Letters, digits and dashes. Upper-cased for you."
        >
          <Input maxLength={32} placeholder="ENG-PLT" aria-label="Department code" />
        </Form.Item>
        <Form.Item name="description" label="What it does">
          <Input.TextArea rows={2} maxLength={240} aria-label="Department description" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
