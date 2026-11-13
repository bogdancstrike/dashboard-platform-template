import { useMutation } from "@tanstack/react-query";
import { Alert, Form, Input, InputNumber, Modal, Select, Space } from "antd";

import { apiClientsApi, type ApiClientRow, type Minted } from "@/api/apiClients";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

interface NewClientModalProps {
  open: boolean;
  scopes: Array<{ code: string; label: string }>;
  withheld: unknown[];
  onClose: () => void;
  onCreated: (made: ApiClientRow & Minted) => Promise<void>;
  onError: (error: unknown) => void;
}

/** Register a client; its first key is minted with it and shown once. */
export function NewClientModal({ open, scopes, withheld, onClose, onCreated, onError }: NewClientModalProps) {
  const [form] = Form.useForm();
  const { touch, settled, requestClose } = useDiscardGuard({ close: onClose, what: "client" });

  const create = useMutation({
    mutationFn: (body: { name: string; scopes?: string[] }) => apiClientsApi.create(body),
    onSuccess: async (made) => {
      settled();
      onClose();
      form.resetFields();
      await onCreated(made);
    },
    onError,
  });

  return (

    <Modal
      open={open}
      onCancel={requestClose}
      title="Register an API client"
      okText="Register it"
      confirmLoading={create.isPending}
      onOk={() => {
        void form
          .validateFields()
          .then((values: { name: string; scopes?: string[] }) => create.mutate(values))
          .catch(() => {
            // The form is already showing why.
          });
      }}
      okButtonProps={{ "data-testid": "create-client" }}
    >
      <Form form={form} layout="vertical" data-testid="client-form" onValuesChange={touch}>
        <Alert
          type="warning"
          showIcon
          className="nu-block"
          message="Its key is shown once"
          description="The platform stores only a hash, so there is no way to see it again. Copy it before you close the box."
        />
        <Form.Item
          name="name"
          label="What is calling"
          rules={[{ required: true, message: "A client needs a name." }]}
        >
          <Input autoFocus maxLength={160} placeholder="Warehouse sync" aria-label="Client name" />
        </Form.Item>
        <Form.Item
          name="scopes"
          label="What it may do"
          extra={
            withheld.length > 0
              ? `${withheld.length} more exist that you cannot grant, because you do not hold them yourself.`
              : "A client cannot be given a permission you do not hold."
          }
        >
          <Select
            mode="multiple"
            aria-label="Scopes"
            placeholder="Nothing — it can authenticate and read nothing"
            optionFilterProp="label"
            options={scopes.map((item) => ({
              value: item.code,
              label: `${item.code} — ${item.label}`,
            }))}
          />
        </Form.Item>
        <Space size={12}>
          <Form.Item name="rate_limit_per_minute" label="Requests a minute">
            <InputNumber min={1} max={100000} placeholder="600" aria-label="Rate limit" />
          </Form.Item>
          <Form.Item name="quota_per_day" label="Requests a day">
            <InputNumber min={1} max={100000000} placeholder="100000" aria-label="Daily quota" />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}
