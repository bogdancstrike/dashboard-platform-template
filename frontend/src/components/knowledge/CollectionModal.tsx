import { useEffect } from "react";
import { Form, Input, Modal, Segmented, Space, Typography } from "antd";

import type { Collection, CollectionInput, CollectionScope } from "@/api/knowledge";
import { PeoplePicker } from "@/components/PeoplePicker";

/** The colours a collection may wear — the design's series inks. */
export const COLLECTION_COLORS = ["#2457D6", "#0E9F6E", "#C2410C", "#7C3AED", "#DB2777", "#0891B2", "#CA8A04"];

const SCOPES: { value: CollectionScope; label: string; hint: string }[] = [
  { value: "PRIVATE", label: "Only me", hint: "Nobody else can ask it anything." },
  { value: "SHARED", label: "People I choose", hint: "They can ask questions and read the files' answers." },
  { value: "PUBLIC", label: "Everyone", hint: "Every signed-in person can ask it." },
];

interface Values {
  name: string;
  description: string;
  scope: CollectionScope;
  color: string;
  member_ids: string[];
}

/** New collection, or a change to one — name, audience and colour. */
export function CollectionModal({
  open,
  initial,
  saving,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  initial?: Collection | null;
  saving?: boolean;
  onCancel: () => void;
  onSubmit: (input: CollectionInput) => void;
}) {
  const [form] = Form.useForm<Values>();
  const scope = Form.useWatch("scope", form);
  const color = Form.useWatch("color", form);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      scope: initial?.scope ?? "PRIVATE",
      color: initial?.color ?? COLLECTION_COLORS[0],
      member_ids: initial?.members?.map((m) => m.id) ?? [],
    });
  }, [open, initial, form]);

  return (
    <Modal
      open={open}
      title={initial ? "Edit collection" : "New collection"}
      okText={initial ? "Save" : "Create collection"}
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => form.submit()}
      destroyOnClose
      data-testid="collection-modal"
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(values) =>
          onSubmit({
            name: values.name.trim(),
            description: values.description?.trim() ?? "",
            scope: values.scope,
            color: values.color,
            member_ids: values.scope === "SHARED" ? values.member_ids : [],
          })
        }
      >
        <Form.Item
          name="name"
          label="Name"
          rules={[
            { required: true, whitespace: true, message: "A collection needs a name." },
            { max: 160, message: "At most 160 characters." },
          ]}
        >
          <Input placeholder="Company policies" data-testid="collection-name" autoFocus />
        </Form.Item>
        <Form.Item name="description" label="What is in it">
          <Input.TextArea rows={2} placeholder="The handbook and the security policy" maxLength={2000} />
        </Form.Item>
        <Form.Item name="scope" label="Who can ask it">
          <Segmented
            block
            options={SCOPES.map((s) => ({ value: s.value, label: s.label }))}
            data-testid="collection-scope"
          />
        </Form.Item>
        <Typography.Text type="secondary" className="nx-kn-hint">
          {SCOPES.find((s) => s.value === scope)?.hint}
        </Typography.Text>
        {scope === "SHARED" && (
          <Form.Item name="member_ids" label="People" className="nu-block">
            <MembersField known={initial?.members ?? []} />
          </Form.Item>
        )}
        <Form.Item name="color" label="Colour" className="nu-block">
          <Space size={8} wrap>
            {COLLECTION_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Colour ${swatch}`}
                aria-pressed={color === swatch}
                className={`nx-kn-swatch${color === swatch ? " is-on" : ""}`}
                style={{ background: swatch }}
                onClick={() => form.setFieldValue("color", swatch)}
              />
            ))}
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** PeoplePicker as a form control: the form owns the value. */
function MembersField({
  value,
  onChange,
  known,
}: {
  value?: string[];
  onChange?: (ids: string[]) => void;
  known: { id: string; name: string; email: string }[];
}) {
  return (
    <PeoplePicker
      value={value ?? []}
      onChange={(ids) => onChange?.(ids)}
      known={known.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        username: m.email.split("@")[0] ?? m.email,
        job_title: null,
        avatar_url: null,
        initials: m.name
          .split(/\s+/)
          .map((part) => part[0] ?? "")
          .join("")
          .slice(0, 2)
          .toUpperCase(),
        is_me: false,
      }))}
      data-testid="collection-members"
    />
  );
}
