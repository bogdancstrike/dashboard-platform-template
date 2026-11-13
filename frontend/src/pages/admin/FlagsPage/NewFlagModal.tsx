import { useMutation } from "@tanstack/react-query";
import { Alert, App as AntApp, Form, Input, Modal } from "antd";

import { settingsApi } from "@/api/settings";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { apiMessageToast } from "@/lib/errors";

/** Create a flag; it arrives off and reaching nobody. */
export function NewFlagModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<{ key: string; name: string; description?: string }>();
  const { touch, settled, requestClose } = useDiscardGuard({
    close: () => {
      form.resetFields();
      onClose();
    },
    what: "flag",
  });

  const create = useMutation({
    mutationFn: (values: { key: string; name: string; description?: string }) => settingsApi.createFlag(values),
    onSuccess: (flag) => {
      settled();
      message.success(`${flag.name} exists, and it is off`);
      form.resetFields();
      onClose();
      onCreated();
    },
    onError: apiMessageToast(message, "That flag could not be created."),
  });

  return (
    <Modal
      open={open}
      title="New feature flag"
      okText="Create it, off"
      confirmLoading={create.isPending}
      onCancel={requestClose}
      onOk={() => void form.submit()}
      okButtonProps={{ "data-testid": "create-flag" }}
    >
      <Alert
        className="nu-block"
        type="info"
        showIcon
        message="It arrives off, and reaching nobody"
        description="Turn it on and set its rollout when whatever it guards is ready to be seen."
      />
      <Form
        form={form}
        layout="vertical"
        onValuesChange={touch}
        requiredMark={false}
        onFinish={(values) => create.mutate(values)}
        data-testid="flag-form"
      >
        <Form.Item name="name" label="What does it guard?" rules={[{ required: true, message: "A flag needs a name" }]}>
          <Input autoFocus maxLength={160} placeholder="Saved chart thumbnails" aria-label="Flag name" />
        </Form.Item>
        <Form.Item
          name="key"
          label="Its key"
          extra="What the code checks for. Lower case, dashes, and never renamed."
          rules={[
            { required: true, message: "A flag needs a key" },
            { pattern: /^[a-z0-9-]{2,96}$/, message: "Lower case letters, digits and dashes" },
          ]}
        >
          <Input className="nu-mono" placeholder="saved-chart-thumbnails" aria-label="Flag key" />
        </Form.Item>
        <Form.Item name="description" label="Anything worth saying about it">
          <Input.TextArea rows={2} maxLength={2000} placeholder="Optional" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
