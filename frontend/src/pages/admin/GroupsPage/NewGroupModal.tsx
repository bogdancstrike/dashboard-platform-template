import { useMutation } from "@tanstack/react-query";
import { Alert, App as AntApp, Form, Input, Modal, Select } from "antd";

import { groupsApi, type Group, type GroupKind } from "@/api/groups";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

interface NewGroupModalProps {
  open: boolean;
  kinds: Array<{ key: string }>;
  onClose: () => void;
  onCreated: (group: Group) => Promise<void>;
  onError: (error: unknown) => void;
}

/** Name a new group; it starts granting nothing. */
export function NewGroupModal({ open, kinds, onClose, onCreated, onError }: NewGroupModalProps) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const { touch, settled, requestClose } = useDiscardGuard({ close: onClose, what: "group" });

  const create = useMutation({
    mutationFn: (body: { name: string; kind?: GroupKind; description?: string }) => groupsApi.create(body),
    onSuccess: async (group) => {
      settled();
      message.success(`${group.name} exists, and grants nothing yet.`);
      onClose();
      form.resetFields();
      // Straight into the group, because the next thing anybody wants is to
      // put people in it.
      await onCreated(group);
    },
    onError,
  });

  return (
    <Modal
      open={open}
      onCancel={requestClose}
      title="New group"
      okText="Make it"
      confirmLoading={create.isPending}
      onOk={() => {
        void form
          .validateFields()
          .then((values: { name: string; kind?: GroupKind; description?: string }) => create.mutate(values))
          .catch(() => {
            // `validateFields` rejects on an empty field and the form is
            // already showing why; swallowing it here is what stops an
            // unhandled rejection in the test run.
          });
      }}
      okButtonProps={{ "data-testid": "create-group" }}
    >
      <Form form={form} layout="vertical" onValuesChange={touch} data-testid="group-form" initialValues={{ kind: "TEAM" }}>
        {/* Said on the way in, because a group that arrived granting
            something would grant it at the moment it was made. */}
        <Alert
          type="info"
          showIcon
          className="nu-block"
          message="It starts granting nothing"
          description="What a group grants is set separately, and needs `roles.manage`."
        />
        <Form.Item name="name" label="Name" rules={[{ required: true, message: "A group needs a name." }]}>
          <Input autoFocus maxLength={80} placeholder="Release managers" aria-label="Group name" />
        </Form.Item>
        <Form.Item name="kind" label="Kind">
          <Select
            aria-label="Group kind"
            options={kinds.map((item) => ({ value: item.key, label: item.key.toLowerCase() }))}
          />
        </Form.Item>
        <Form.Item name="description" label="What it is for">
          <Input.TextArea
            rows={2}
            maxLength={240}
            placeholder="Who to page when a release goes wrong."
            aria-label="Group description"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
