import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Form, Input, InputNumber, Modal, Select } from "antd";

import { approvalsApi, type ChangeRule, type RuleCatalogue } from "@/api/approvals";
import { errorToast } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

/** Add or change a rule: a dataset, a field and the condition that holds an edit back. */
export function RuleModal({ rule, catalogue, onClose }: { rule: Partial<ChangeRule> | null; catalogue: RuleCatalogue; onClose: () => void }) {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [form] = Form.useForm();
  const resourceType = Form.useWatch("resource_type", form) as string | undefined;
  const fieldName = Form.useWatch("field", form) as string | undefined;
  const operator = Form.useWatch("operator", form) as ChangeRule["operator"] | undefined;
  useEffect(() => {
    if (rule) { form.resetFields(); form.setFieldsValue({ name: "", description: "", ...rule }); }
  }, [rule, form]);
  const dataset = catalogue.catalogue.find((item) => item.resource_type === resourceType);
  const field = dataset?.fields.find((item) => item.name === fieldName);
  const save = useMutation({
    mutationFn: (values: Partial<ChangeRule>) =>
      rule?.id ? approvalsApi.updateRule(rule.id, values) : approvalsApi.createRule(values),
    onSuccess: () => { void client.invalidateQueries({ queryKey: queryKeys.approvals("rules") }); message.success("Rule saved"); onClose(); },
    onError: errorToast(message, { action: "save this rule" }),
  });
  const valueInput = field?.choices.length ? (
    <Select mode={operator === "IN" ? "multiple" : undefined} options={field.choices.map((choice) => ({ value: choice, label: choice }))} />
  ) : field?.kind === "number" ? <InputNumber style={{ width: "100%" }} /> : <Input />;
  return (
    <Modal open={Boolean(rule)} title={rule?.id ? "Edit rule" : "New approval rule"} onCancel={onClose} onOk={() => form.submit()} confirmLoading={save.isPending} forceRender>
      <Form form={form} layout="vertical" onFinish={(values: Partial<ChangeRule>) => save.mutate(values)}>
        <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input placeholder="Large discounts need sign-off" /></Form.Item>
        <Form.Item name="resource_type" label="Dataset" rules={[{ required: true }]}>
          <Select options={catalogue.catalogue.map((item) => ({ value: item.resource_type, label: item.label }))} onChange={() => form.setFieldValue("field", undefined)} />
        </Form.Item>
        <Form.Item name="field" label="Field" rules={[{ required: true }]}>
          <Select options={(dataset?.fields ?? []).map((item) => ({ value: item.name, label: item.label }))} disabled={!dataset} />
        </Form.Item>
        <Form.Item name="operator" label="Hold the edit when the new value…" rules={[{ required: true }]}>
          <Select options={[
            { value: "ANY", label: "…is anything different" }, { value: "EQUALS", label: "…equals" },
            { value: "IN", label: "…is one of" }, { value: "GT", label: "…is greater than" }, { value: "LT", label: "…is less than" },
          ]} />
        </Form.Item>
        {operator && operator !== "ANY" && <Form.Item name="value" label="Value" rules={[{ required: true }]}>{valueInput}</Form.Item>}
        <Form.Item name="description" label="Why (shown to the requester)"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
