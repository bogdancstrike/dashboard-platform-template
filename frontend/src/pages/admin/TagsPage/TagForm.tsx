import { useMutation } from "@tanstack/react-query";
import { App as AntApp, Form, Input, Modal, Select } from "antd";

import type { Tag, TagCategory } from "@/api/tags";
import { tagsApi } from "@/api/tags";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { apiMessageToast } from "@/lib/errors";
import { SEMANTIC } from "@/theme/tokens";

import { CATEGORIES } from "./vocabulary";

/** Add or change one tag. */
export function TagForm({
  open,
  tag,
  onClose,
  onSaved,
}: {
  open: boolean;
  tag: Tag | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const { touch, settled, requestClose } = useDiscardGuard({
    close: onClose,
    what: "tag",
  });
  const { message } = AntApp.useApp();

  const save = useMutation({
    mutationFn: (values: { name: string; color: string; description?: string; category: TagCategory }) =>
      tag ? tagsApi.update(tag.id, values) : tagsApi.create(values),
    onSuccess: () => {
      settled();
      message.success(tag ? "Tag saved" : "Tag added");
      onSaved();
    },
    onError: apiMessageToast(message, "That tag could not be saved."),
  });

  return (
    <Modal
      open={open}
      onCancel={requestClose}
      title={tag ? `Edit “${tag.name}”` : "New tag"}
      okText={tag ? "Save" : "Add"}
      confirmLoading={save.isPending}
      onOk={() => void form.submit()}
      destroyOnHidden
      data-testid="tag-form"
    >
      <Form
        form={form}
        layout="vertical"
        onValuesChange={touch}
        size="small"
        initialValues={{
          name: tag?.name ?? "",
          // The palette's neutral, so a tag nobody coloured looks unassigned.
          color: tag?.color ?? SEMANTIC.neutral,
          description: tag?.description ?? "",
          category: tag?.category ?? "GENERAL",
        }}
        // Typed at the boundary rather than trusted: AntD's `onFinish` hands
        // back `any`, and a form field renamed would otherwise reach the API
        // as an undefined the server refuses for a reason nobody can see here.
        onFinish={(values: {
          name: string;
          color: string;
          description?: string;
          category: TagCategory;
        }) => save.mutate(values)}
      >
        <TagFields tag={tag} />
      </Form>
    </Modal>
  );
}

function TagFields({ tag }: { tag: Tag | null }) {
  return (
    <>
      <Form.Item
        label="Name"
        name="name"
        rules={[{ required: true, message: "A tag needs a name" }]}
        extra={
          tag?.is_system
            ? "A system tag cannot be renamed: automations and saved searches quote it by name."
            : "“Urgent” and “urgent” are one tag."
        }
      >
        <Input maxLength={48} disabled={tag?.is_system} data-testid="tag-name" />
      </Form.Item>
      <Form.Item label="Category" name="category">
        <Select
          options={CATEGORIES.map((value) => ({ value, label: value }))}
          data-testid="tag-category"
        />
      </Form.Item>
      {/* palette-exempt: copy, not a colour — the example a reader types over. */}
      <Form.Item label="Colour" name="color" extra="Six-digit hex, like #dc2626.">
        <Input maxLength={7} data-testid="tag-color" />
      </Form.Item>
      <Form.Item
        label="What it means"
        name="description"
        extra="One sentence. A tag two people read differently classifies nothing."
      >
        <Input.TextArea rows={2} maxLength={240} data-testid="tag-description" />
      </Form.Item>
    </>
  );
}
