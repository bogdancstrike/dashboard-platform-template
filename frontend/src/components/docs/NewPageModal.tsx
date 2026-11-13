/**
 * A new page (§48): where it goes, what it starts from, and what it is called.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { App as AntApp, Form, Input, Modal, Select, type SelectProps } from "antd";

import { ApiError } from "@/api/client";
import { docsApi, type DocPage, type DocSpace, type TreeItem } from "@/api/docs";
import { STALE, queryKeys } from "@/lib/queryKeys";

export function NewPageModal({
  open,
  spaces,
  spaceId,
  parentId,
  pages,
  onClose,
  onCreated,
}: {
  open: boolean;
  spaces: DocSpace[];
  spaceId?: string;
  parentId?: string | null;
  pages: TreeItem[];
  onClose: () => void;
  onCreated: (page: DocPage) => void;
}) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<{ space_id: string; parent_id?: string; template: string; title: string }>();
  const templates = useQuery({
    queryKey: queryKeys.docTemplates(),
    queryFn: ({ signal }) => docsApi.templates(signal),
    enabled: open,
    staleTime: STALE.long,
  });
  const chosenSpace = Form.useWatch("space_id", form) ?? spaceId;
  const create = useMutation({
    mutationFn: (values: { space_id: string; parent_id?: string; template: string; title: string }) =>
      docsApi.create({
        space_id: values.space_id,
        parent_id: values.parent_id || null,
        template: values.template,
        title: values.title?.trim() || undefined,
      }),
    onSuccess: (page) => {
      form.resetFields();
      onCreated(page);
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : "The page was not created."),
  });
  const items = templates.data?.items ?? [];

  return (
    <Modal
      open={open}
      title="New page"
      okText="Create page"
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={create.isPending}
      okButtonProps={{ "data-testid": "create-page" }}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ space_id: spaceId, parent_id: parentId ?? undefined, template: "blank" }}
        onFinish={(values) => create.mutate(values)}
      >
        <Form.Item name="title" label="Title">
          <Input placeholder="Untitled" maxLength={200} aria-label="Page title" autoFocus />
        </Form.Item>
        <Form.Item name="template" label="Start from">
          <div className="nx-dc-templates" role="radiogroup" aria-label="Template">
            <Form.Item noStyle shouldUpdate>
              {() =>
                items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="radio"
                    aria-checked={form.getFieldValue("template") === item.key}
                    className={form.getFieldValue("template") === item.key ? "is-on" : undefined}
                    onClick={() => form.setFieldValue("template", item.key)}
                    data-testid={`template-${item.key}`}
                  >
                    <span aria-hidden className="nx-dc-template-icon">{item.icon}</span>
                    <strong>{item.name}</strong>
                    <span>{item.description}</span>
                  </button>
                ))
              }
            </Form.Item>
          </div>
        </Form.Item>
        <Form.Item name="space_id" label="Space" rules={[{ required: true, message: "Pick a space." }]}>
          <RequiredSelect
            aria-label="Space"
            options={spaces.map((space) => ({ value: space.id, label: `${space.icon ?? ""} ${space.name}`.trim() }))}
            onChange={() => form.setFieldValue("parent_id", undefined)}
          />
        </Form.Item>
        <Form.Item name="parent_id" label="Inside">
          <Select
            aria-label="Parent page"
            allowClear
            placeholder="At the top of the space"
            options={(chosenSpace === spaceId ? pages : []).map((page) => ({ value: page.id, label: page.title }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/**
 * A Select inside a required Form.Item. AntD hands the item's
 * `aria-required` to the Select, which puts it on its wrapper `div` — an
 * element that may not carry it (axe aria-allowed-attr, audit A). The
 * requirement is still said by the label's mark and the validation message.
 */
function RequiredSelect(props: SelectProps & { "aria-required"?: unknown }) {
  const { "aria-required": _required, ...rest } = props;
  return <Select {...rest} />;
}
