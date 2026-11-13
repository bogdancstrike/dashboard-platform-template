import { Button, Card, Popconfirm, Space, Tag, Tooltip, Typography } from "antd";
import {
  CopyOutlined,
  DashboardOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  LockOutlined,
  StarFilled,
  StarOutlined,
  TeamOutlined,
} from "@ant-design/icons";

import type { SavedSearch } from "@/api/explorer";

const { Text } = Typography;

/** `preset`, not `color`: AntD preset names, whose ink the global stylesheet (`styles/global`) fixes. A
 * field called color is where a hex ends up, and a hex on a `Tag` is white
 * text on a fill nobody measured (§55) — see `EdgeTag`. */
const SCOPE_TAG: Record<SavedSearch["scope"], { icon: JSX.Element; label: string; preset?: string }> = {
  PRIVATE: { icon: <LockOutlined />, label: "Private" },
  SHARED: { icon: <TeamOutlined />, label: "Shared", preset: "blue" },
  PUBLIC: { icon: <GlobalOutlined />, label: "Public", preset: "green" },
};

/**
 * One saved search: what it asks, who owns it, who can see it — and only the
 * actions the API will allow this reader.
 */
export function SavedSearchCard({
  item,
  dashboardsOn,
  opening,
  onOpen,
  onFavourite,
  onEdit,
  onPin,
  onDuplicate,
  onRemove,
}: {
  item: SavedSearch;
  dashboardsOn: boolean;
  /** This card's search is being opened. */
  opening: boolean;
  onOpen: () => void;
  onFavourite: () => void;
  onEdit: () => void;
  onPin: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const scope = SCOPE_TAG[item.scope];
  return (
    <Card size="small" className="nu-saved-card">
      <div className="nu-saved-heading">
        <button
          className="nu-link-button"
          type="button"
          onClick={onOpen}
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
                onClick={onFavourite}
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
                onClick={onEdit}
              />
            </Tooltip>
          )}
          {dashboardsOn && (
            <Tooltip title="Answer this on a dashboard">
              <Button
                type="text"
                size="small"
                aria-label={`Add ${item.name} to a dashboard`}
                icon={<DashboardOutlined />}
                onClick={onPin}
              />
            </Tooltip>
          )}
          <Tooltip title="Duplicate as a private search">
            <Button
              type="text"
              size="small"
              aria-label={`Duplicate ${item.name}`}
              icon={<CopyOutlined />}
              onClick={onDuplicate}
            />
          </Tooltip>
          {item.can_edit && (
            <Popconfirm title="Delete this saved search?" onConfirm={onRemove}>
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
        <Tag icon={scope.icon} color={scope.preset}>{scope.label}</Tag>
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
        onClick={onOpen}
        loading={opening}
      >
        Open
      </Button>
    </Card>
  );
}
