import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";

import { explorerApi, type SavedSearch, type SaveSearchInput } from "@/api/explorer";

const { Text } = Typography;

export function SavedSearchDrawer({
  open,
  resourceType,
  onClose,
  onOpen,
}: {
  open: boolean;
  resourceType: string;
  onClose: () => void;
  onOpen: (search: SavedSearch) => void;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["saved-searches", resourceType],
    queryFn: ({ signal }) => explorerApi.saved(resourceType, signal),
    enabled: open && Boolean(resourceType),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["saved-searches", resourceType] });

  const openSearch = useMutation({
    mutationFn: (id: string) => explorerApi.openSaved(id),
    onSuccess: (search) => { onOpen(search); onClose(); },
    onError: (error: Error) => message.error(error.message),
  });
  const duplicate = useMutation({
    mutationFn: explorerApi.duplicateSaved,
    onSuccess: async () => { await refresh(); message.success("Private copy created"); },
    onError: (error: Error) => message.error(error.message),
  });
  const remove = useMutation({
    mutationFn: explorerApi.deleteSaved,
    onSuccess: async () => { await refresh(); message.success("Saved search deleted"); },
    onError: (error: Error) => message.error(error.message),
  });
  const favourite = useMutation({
    mutationFn: ({ item, value }: { item: SavedSearch; value: boolean }) =>
      explorerApi.updateSaved(item.id, { is_favorite: value }),
    onSuccess: refresh,
    onError: (error: Error) => message.error(error.message),
  });

  return (
    <Drawer open={open} width={520} title="Saved searches" onClose={onClose}>
      <List
        loading={query.isLoading}
        dataSource={query.data?.items ?? []}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No saved searches for this dataset" /> }}
        renderItem={(item) => (
          <List.Item>
            <Card size="small" className="nu-saved-card">
              <div className="nu-saved-heading">
                <button className="nu-link-button" type="button" onClick={() => openSearch.mutate(item.id)}>
                  {item.name}
                </button>
                <Space size={2}>
                  {item.can_edit && (
                    <Tooltip title={item.is_favorite ? "Remove from favourites" : "Add to favourites"}>
                      <Button
                        type="text"
                        size="small"
                        aria-label={item.is_favorite ? "Remove from favourites" : "Add to favourites"}
                        icon={item.is_favorite ? <StarFilled /> : <StarOutlined />}
                        onClick={() => favourite.mutate({ item, value: !item.is_favorite })}
                      />
                    </Tooltip>
                  )}
                  <Tooltip title="Duplicate as a private search">
                    <Button type="text" size="small" aria-label={`Duplicate ${item.name}`} icon={<CopyOutlined />} onClick={() => duplicate.mutate(item.id)} />
                  </Tooltip>
                  {item.can_edit && (
                    <Popconfirm title="Delete this saved search?" onConfirm={() => remove.mutate(item.id)}>
                      <Button danger type="text" size="small" aria-label={`Delete ${item.name}`} icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )}
                </Space>
              </div>
              <Space size={[6, 6]} wrap>
                <Tag>{item.scope.toLowerCase()}</Tag>
                <Tag>{item.rule_count} {item.rule_count === 1 ? "rule" : "rules"}</Tag>
                <Text type="secondary">by {item.owner.name}</Text>
              </Space>
              <div className="nu-saved-condition">
                <Text type="secondary">{item.condition_text?.trim() || item.query_text || "All records"}</Text>
              </div>
              <Button icon={<FolderOpenOutlined />} onClick={() => openSearch.mutate(item.id)} loading={openSearch.isPending}>
                Open
              </Button>
            </Card>
          </List.Item>
        )}
      />
    </Drawer>
  );
}

export function SaveSearchModal({
  open,
  value,
  onClose,
  onSaved,
}: {
  open: boolean;
  value: Omit<SaveSearchInput, "name">;
  onClose: () => void;
  onSaved: (search: SavedSearch) => void;
}) {
  const [form] = Form.useForm<{ name: string; description: string; scope: "PRIVATE" | "PUBLIC" }>();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (formValue: { name: string; description: string; scope: "PRIVATE" | "PUBLIC" }) =>
      explorerApi.createSaved({ ...value, ...formValue }),
    onSuccess: async (search) => {
      await queryClient.invalidateQueries({ queryKey: ["saved-searches", value.resource_type] });
      form.resetFields();
      message.success("Search saved");
      onSaved(search);
      onClose();
    },
    onError: (error: Error) => message.error(error.message),
  });

  return (
    <Modal
      open={open}
      title="Save this search"
      okText="Save search"
      confirmLoading={save.isPending}
      onCancel={onClose}
      onOk={() => form.validateFields().then((formValue) => save.mutate(formValue))}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={{ scope: "PRIVATE", description: "" }} preserve={false}>
        <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true, max: 200 }]}>
          <Input autoFocus placeholder="e.g. Critical work due this week" />
        </Form.Item>
        <Form.Item name="description" label="Description" rules={[{ max: 2000 }]}>
          <Input.TextArea rows={2} placeholder="Why this question matters (optional)" />
        </Form.Item>
        <Form.Item name="scope" label="Visibility" extra="Private is the safe default. Only the owner can edit either choice.">
          <Segmented options={[{ label: "Private", value: "PRIVATE" }, { label: "Public", value: "PUBLIC" }]} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
