import { Button, DatePicker, Form, Input, InputNumber, Rate, Select, Upload } from "antd";
import { useState } from "react";

import { isVisible, type FormField } from "@/api/forms";

/**
 * An intake form as the person answering it sees it — the public page, an
 * internal form and the designer's preview all render through this, so the
 * preview is the form rather than a picture of it.
 *
 * Visibility mirrors the server's rule (`forms._visible`): a field whose
 * condition is not met is neither shown nor sent, and the server ignores it
 * anyway.
 */
export function FormRenderer({
  fields,
  submitLabel = "Send",
  disabled = false,
  busy = false,
  onSubmit,
  extra,
  errors = {},
}: {
  fields: FormField[];
  submitLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  onSubmit?: (answers: Record<string, unknown>) => void;
  extra?: React.ReactNode;
  errors?: Record<string, string>;
}) {
  const [form] = Form.useForm();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  const finish = (values: Record<string, unknown>) => {
    const visible: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.type === "heading" || !isVisible(field, values)) continue;
      const value = values[field.id];
      if (value === undefined || value === null || value === "") continue;
      visible[field.id] = field.type === "date" && value && typeof value === "object" && "format" in value
        ? (value as { format: (f: string) => string }).format("YYYY-MM-DD")
        : value;
    }
    onSubmit?.(visible);
  };

  return (
    <Form
      form={form}
      layout="vertical"
      disabled={disabled}
      onFinish={finish}
      onValuesChange={(_changed, all) => setAnswers(all)}
      requiredMark="optional"
    >
      {fields.map((field) => {
        if (!isVisible(field, answers)) return null;
        if (field.type === "heading") return <h3 key={field.id}>{field.label}</h3>;
        const rules = field.required ? [{ required: true, message: `${field.label} is required` }] : [];
        if (field.type === "email") rules.push({ type: "email", message: "That does not look like an email address" } as never);
        return (
          <Form.Item
            key={field.id}
            name={field.id}
            label={field.label}
            extra={field.help || undefined}
            rules={rules}
            validateStatus={errors[field.id] ? "error" : undefined}
            help={errors[field.id] || undefined}
            valuePropName={field.type === "file" ? "value" : undefined}
          >
            <Control field={field} />
          </Form.Item>
        );
      })}
      {extra}
      <Button type="primary" htmlType="submit" size="large" block loading={busy} data-testid="form-submit">
        {submitLabel}
      </Button>
    </Form>
  );
}

function Control({ field, value, onChange }: { field: FormField; value?: unknown; onChange?: (value: unknown) => void }) {
  const common = { "aria-label": field.label, placeholder: field.placeholder || undefined };
  switch (field.type) {
    case "textarea":
      return <Input.TextArea rows={4} {...common} value={value as string} onChange={(e) => onChange?.(e.target.value)} />;
    case "email":
      return <Input type="email" {...common} value={value as string} onChange={(e) => onChange?.(e.target.value)} />;
    case "number":
      return <InputNumber style={{ width: "100%" }} {...common} value={value as number} onChange={(v) => onChange?.(v)} />;
    case "select":
      return <Select {...common} value={value as string} onChange={onChange} options={(field.options ?? []).map((o) => ({ value: o, label: o }))} />;
    case "multiselect":
      return <Select mode="multiple" {...common} value={value as string[]} onChange={onChange} options={(field.options ?? []).map((o) => ({ value: o, label: o }))} />;
    case "date":
      return <DatePicker style={{ width: "100%" }} aria-label={field.label} value={value as never} onChange={(v) => onChange?.(v)} />;
    case "rating":
      return <Rate count={field.max ?? 5} value={value as number} onChange={(v) => onChange?.(v)} aria-label={field.label} />;
    case "file":
      return <FileControl value={value as { name: string } | undefined} onChange={onChange} label={field.label} />;
    default:
      return <Input {...common} value={value as string} onChange={(e) => onChange?.(e.target.value)} />;
  }
}

function FileControl({ value, onChange, label }: { value?: { name: string }; onChange?: (value: unknown) => void; label: string }) {
  return (
    <Upload
      maxCount={1}
      accept="image/*,.pdf,.txt,.csv,.docx,.xlsx"
      fileList={value ? [{ uid: "1", name: value.name, status: "done" }] : []}
      onRemove={() => { onChange?.(undefined); return true; }}
      beforeUpload={(file) => {
        const reader = new FileReader();
        reader.onload = () => onChange?.({ name: file.name, data: typeof reader.result === "string" ? reader.result : "" });
        reader.readAsDataURL(file);
        return false;
      }}
    >
      <Button aria-label={`Attach ${label}`}>Attach a file</Button>
    </Upload>
  );
}
