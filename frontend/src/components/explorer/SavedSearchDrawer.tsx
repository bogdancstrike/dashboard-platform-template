/**
 * Saved searches, as a module of the search screen rather than a page (§5).
 *
 * Each card says what the search asks, who owns it and who can see it, because
 * those are the three things that decide whether to open somebody else's saved
 * search or duplicate it. The actions available on a card are exactly the ones
 * the API will allow: a member sees Open and Duplicate, an owner also sees
 * Edit, Favourite and Delete. Offering an action that returns 403 teaches
 * people to distrust the whole panel.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  List,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  LockOutlined,
  StarFilled,
  StarOutlined,
  TeamOutlined,
} from "@ant-design/icons";

import { explorerApi, type SavedSearch } from "@/api/explorer";

const { Text } = Typography;

const SCOPE_TAG: Record<SavedSearch["scope"], { icon: JSX.Element; label: string; color?: string }> = {
  PRIVATE: { icon: <LockOutlined />, label: "Private" },
  SHARED: { icon: <TeamOutlined />, label: "Shared", color: "blue" },
  PUBLIC: { icon: <GlobalOutlined />, label: "Public", color: "green" },
};

export interface SavedSearchDrawerProps {
  open: boolean;
  resourceType: string;
  onClose: () => void;
  onOpen: (search: SavedSearch) => void;
  /** Opens the editor for a search the caller owns. */
  onEdit: (search: SavedSearch) => void;
}

export function SavedSearchDrawer({
  open,
  resourceType,
  onClose,
  onOpen,
  onEdit,
}: SavedSearchDrawerProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");

  const query = useQuery({
    queryKey: ["saved-searches", resourceType],
    queryFn: ({ signal }) => explorerApi.saved(resourceType, signal),
    enabled: open && Boolean(resourceType),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["saved-searches", resourceType] });

  const openSearch = useMutation({
    mutationFn: (id: string) => explorerApi.openSaved(id),
    // `onOpen` restores the whole question, panel included — it closes this
    // drawer by leaving it out. Calling `onClose` as well would write the URL
    // a second time, from the state as it was before the search was loaded.
    onSuccess: (search) => onOpen(search),
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

  // Filtered here, not on the server: the list is one person's saved searches,
  // and a round trip to narrow a dozen cards would be slower than typing.
  const needle = term.trim().toLowerCase();
  const items = (query.data?.items ?? []).filter((item) =>
    !needle ||
    [item.name, item.description ?? "", item.condition_text ?? "", item.owner.name]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );

  return (
    <Drawer open={open} width={560} title="Saved searches" onClose={onClose}>
      <Input.Search
        allowClear
        aria-label="Filter saved searches"
        placeholder="Filter by name, condition or owner…"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        style={{ marginBottom: 12 }}
      />
      <List
        loading={query.isLoading}
        dataSource={items}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                needle ? "No saved search matches that" : "No saved searches for this dataset"
              }
            />
          ),
        }}
        renderItem={(item) => {
          const scope = SCOPE_TAG[item.scope];
          return (
            <List.Item>
              <Card size="small" className="nu-saved-card">
                <div className="nu-saved-heading">
                  <button
                    className="nu-link-button"
                    type="button"
                    onClick={() => openSearch.mutate(item.id)}
                  >
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
                    {item.can_edit && (
                      <Tooltip title="Rename, describe, share or hand over">
                        <Button
                          type="text"
                          size="small"
                          aria-label={`Edit ${item.name}`}
                          icon={<EditOutlined />}
                          onClick={() => onEdit(item)}
                        />
                      </Tooltip>
                    )}
                    <Tooltip title="Duplicate as a private search">
                      <Button
                        type="text"
                        size="small"
                        aria-label={`Duplicate ${item.name}`}
                        icon={<CopyOutlined />}
                        onClick={() => duplicate.mutate(item.id)}
                      />
                    </Tooltip>
                    {item.can_edit && (
                      <Popconfirm title="Delete this saved search?" onConfirm={() => remove.mutate(item.id)}>
                        <Button
                          danger
                          type="text"
                          size="small"
                          aria-label={`Delete ${item.name}`}
                          icon={<DeleteOutlined />}
                        />
                      </Popconfirm>
                    )}
                  </Space>
                </div>

                {item.description && (
                  <div className="nu-saved-description">
                    <Text type="secondary">{item.description}</Text>
                  </div>
                )}

                <Space size={[6, 6]} wrap>
                  <Tag icon={scope.icon} color={scope.color}>{scope.label}</Tag>
                  <Tag>{item.rule_count} {item.rule_count === 1 ? "rule" : "rules"}</Tag>
                  {item.members.length > 0 && (
                    <Tooltip title={item.members.map((member) => member.name).join(", ")}>
                      <Tag icon={<TeamOutlined />}>{item.members.length} shared with</Tag>
                    </Tooltip>
                  )}
                  <Text type="secondary">
                    by {item.can_edit ? "you" : item.owner.name}
                    {item.use_count > 0 && ` · run ${item.use_count}×`}
                  </Text>
                </Space>

                <div className="nu-saved-condition">
                  <Text type="secondary">
                    {item.condition_text?.trim() || item.query_text || "All records"}
                  </Text>
                </div>

                <Button
                  icon={<FolderOpenOutlined />}
                  onClick={() => openSearch.mutate(item.id)}
                  loading={openSearch.isPending && openSearch.variables === item.id}
                >
                  Open
                </Button>
              </Card>
            </List.Item>
          );
        }}
      />
    </Drawer>
  );
}
