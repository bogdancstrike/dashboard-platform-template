/**
 * The tag vocabulary (§37).
 *
 * A tag is the only classification a *reader* gets to invent. Everything else
 * this platform uses to describe a record — status, priority, health — is a
 * closed vocabulary declared in code, because a filter menu built from free
 * text has four spellings of "urgent" in it. Tags are the deliberate
 * exception, and the price of the exception is that somebody has to curate
 * them. This is where.
 *
 * Four decisions worth the reader's attention.
 *
 * **The usage count is a link.** "urgent · 9" opens the nine records, through
 * the list's own `tags__contains` filter — a count nobody can open is a count
 * nobody can act on (§44), and a tag on nothing is the first thing to delete.
 *
 * **A system tag says so, and its name is not editable.** Automations, saved
 * searches and reports quote a tag by name; renaming one would silently change
 * what they match and deleting it would silently match nothing. Its colour and
 * description are free.
 *
 * **Deleting says how many records it will come off.** "Remove urgent" and
 * "remove urgent from nine records" are different decisions, and only one of
 * them can be made from the first sentence.
 *
 * **A reader without `tags.manage` gets the vocabulary and no controls**, with
 * the permission named — the page is still worth opening to find out what the
 * tags mean (§76).
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Skeleton,
  Space,
  Table,
  Tag as AntTag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import type { Tag, TagCategory, TagVocabulary } from "@/api/tags";
import { tagsApi } from "@/api/tags";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { SEMANTIC } from "@/theme/tokens";
import { formatNumber } from "@/lib/formats";

const { Text } = Typography;

/** The categories the manager groups by — `services/tags.CATEGORIES`. */
export const CATEGORIES: TagCategory[] = [
  "GENERAL",
  "PRIORITY",
  "STATUS",
  "REGION",
  "GOVERNANCE",
  "ENGINEERING",
];

/** What the page says about the vocabulary, in one sentence. */
export function summarise(vocabulary: TagVocabulary | undefined): string {
  if (!vocabulary) return "";
  const unused = vocabulary.items.filter((tag) => tag.usage_count === 0).length;
  const parts = [`${vocabulary.total} tags`];
  if (unused) {
    // The first thing to look at: a tag on nothing is either new or dead, and
    // a vocabulary nobody prunes stops being one.
    parts.push(`${unused} on nothing`);
  }
  return parts.join(" · ");
}

export default function TagsPage() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Tag | "new" | null>(null);

  const query = useQuery({
    queryKey: ["tag-vocabulary"],
    queryFn: ({ signal }) => tagsApi.vocabulary(signal),
  });
  const vocabulary = query.data;

  usePageCommands("tags", [
    {
      id: "tags.new",
      label: "Add a tag to the vocabulary",
      keywords: "tag label new create",
      run: () => setEditing("new"),
    },
  ]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["tag-vocabulary"] });
    // Every record's chips and every list's rows carry tag names.
    void queryClient.invalidateQueries({ queryKey: ["record-tags"] });
    void queryClient.invalidateQueries({ queryKey: ["entity-rows"] });
  };

  const remove = useMutation({
    mutationFn: (tag: Tag) => tagsApi.remove(tag.id),
    onSuccess: (answer) => {
      message.success(
        answer.records
          ? `${answer.name} removed from ${formatNumber(answer.records)} records`
          : `${answer.name} removed`,
      );
      refresh();
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "That tag could not be removed.",
      ),
  });

  const rows = useMemo(
    () =>
      (vocabulary?.items ?? []).filter((tag) => !category || tag.category === category),
    [vocabulary, category],
  );

  const columns: ColumnsType<Tag> = [
    {
      title: "Tag",
      dataIndex: "name",
      render: (_name: string, tag) => (
        <Space size={8} wrap>
          <AntTag className="nu-tag-chip" style={{ borderInlineStartColor: tag.color }}>
            {tag.name}
          </AntTag>
          {tag.is_system && (
            <Tooltip title="Automations, saved searches and reports quote this tag by name, so it cannot be renamed or removed.">
              <AntTag color="processing">system</AntTag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    { title: "Category", dataIndex: "category", width: 140 },
    {
      title: "Used on",
      dataIndex: "usage_count",
      width: 140,
      sorter: (left, right) => left.usage_count - right.usage_count,
      defaultSortOrder: "descend",
      render: (count: number, tag) =>
        count === 0 ? (
          // Said rather than shown as a zero: this is the row somebody came to
          // the page to find.
          <Text type="secondary">nothing</Text>
        ) : (
          // The count is the link, through the list's own filter — so it opens
          // exactly the records it counted.
          <Link
            to={`/tasks?f.tags__contains=${encodeURIComponent(tag.name)}`}
            data-testid={`tag-usage-${tag.slug}`}
          >
            {formatNumber(count)} records
          </Link>
        ),
    },
    { title: "What it means", dataIndex: "description", render: (text: string) => text || "—" },
    ...(vocabulary?.can_manage
      ? [
          {
            title: "",
            key: "actions",
            width: 96,
            render: (_unused: unknown, tag: Tag) => (
              <Space size={4}>
                <Tooltip title="Rename, recolour or describe">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    aria-label={`Edit ${tag.name}`}
                    onClick={() => setEditing(tag)}
                  />
                </Tooltip>
                <Tooltip
                  title={
                    tag.is_system
                      ? "A system tag cannot be removed"
                      : `Remove it from ${formatNumber(tag.usage_count)} records`
                  }
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    disabled={tag.is_system}
                    icon={<DeleteOutlined />}
                    aria-label={`Remove ${tag.name}`}
                    data-testid={`tag-remove-${tag.slug}`}
                    onClick={() =>
                      modal.confirm({
                        title: `Remove “${tag.name}”?`,
                        // The consequence in the question: "remove urgent" and
                        // "remove urgent from nine records" are different
                        // decisions.
                        content: tag.usage_count
                          ? `It comes off ${formatNumber(tag.usage_count)} records. Nothing else about them changes.`
                          : "It is on nothing, so nothing else changes.",
                        okText: "Remove",
                        okButtonProps: { danger: true },
                        onOk: () => remove.mutate(tag),
                      })
                    }
                  />
                </Tooltip>
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Tags"
        subtitle="The one classification a reader invents. Everything else is a declared vocabulary."
        tag={vocabulary ? <AntTag data-testid="tags-total">{summarise(vocabulary)}</AntTag> : undefined}
        actions={
          <Tooltip
            title={vocabulary?.can_manage ? "" : "Your role does not include tags.manage"}
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!vocabulary?.can_manage}
              onClick={() => setEditing("new")}
              data-testid="tag-new"
            >
              New tag
            </Button>
          </Tooltip>
        }
      />

      {query.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : !vocabulary ? (
        <EmptyState title="The vocabulary could not be loaded" />
      ) : (
        <>
          {!vocabulary.can_manage && (
            <Alert
              type="info"
              showIcon
              className="nu-block"
              data-testid="tags-readonly"
              message="You can read the vocabulary but not change it"
              description="Curating tags needs tags.manage — a rename changes what every record carrying the tag says. Applying a tag to a record needs only records.update."
            />
          )}

          <Card size="small" className="nu-filter-bar nu-block">
            <Space size={10} wrap>
              <Text type="secondary">Category</Text>
              <Segmented
                value={category || "all"}
                onChange={(value) => {
                  const next = new URLSearchParams(params);
                  if (value === "all") next.delete("category");
                  else next.set("category", String(value));
                  setParams(next, { replace: true });
                }}
                options={[
                  { value: "all", label: `All (${vocabulary.total})` },
                  ...vocabulary.categories
                    .filter((entry) => entry.count > 0)
                    .map((entry) => ({
                      value: entry.value,
                      label: `${entry.value} (${entry.count})`,
                    })),
                ]}
                data-testid="tags-categories"
              />
            </Space>
          </Card>

          <Card size="small" className="nu-block">
            <Table<Tag>
              rowKey="id"
              size="small"
              columns={columns}
              dataSource={rows}
              pagination={false}
              locale={{
                emptyText: (
                  <EmptyState
                    title="No tags in this category"
                    hint="A tag's category is what makes two people filing one reach for the same place."
                  />
                ),
              }}
              data-testid="tags-table"
            />
          </Card>
        </>
      )}

      <TagForm
        open={editing !== null}
        tag={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />
    </>
  );
}

/** Add or change one tag. */
function TagForm({
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
  const { message } = AntApp.useApp();

  const save = useMutation({
    mutationFn: (values: { name: string; color: string; description?: string; category: TagCategory }) =>
      tag ? tagsApi.update(tag.id, values) : tagsApi.create(values),
    onSuccess: () => {
      message.success(tag ? "Tag saved" : "Tag added");
      onSaved();
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "That tag could not be saved.",
      ),
  });

  return (
    <Modal
      open={open}
      onCancel={onClose}
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
      </Form>
    </Modal>
  );
}
