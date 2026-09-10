/**
 * One dashboard in the gallery (§45).
 *
 * A card rather than a row in a list, and rather than an option in a select,
 * because the thing a reader is choosing between is not a *name* — it is a
 * layout. So the card says what the dashboard **holds**: the widget kinds as
 * tags, which somebody recognises far faster than "7 widgets".
 *
 * Following QSINT's shape: title, description, the kinds it contains, and a
 * footer carrying when it changed and who it belongs to. The actions sit in
 * the header as icon buttons and stop the click from opening the card.
 */

import { Button, Space, Tag, Tooltip, Typography } from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  HomeFilled,
  SettingOutlined,
  TeamOutlined,
} from "@ant-design/icons";

import type { SavedDashboard } from "@/api/dashboards";
import { EdgeTag } from "@/components/EdgeTag";
import { relativeTime } from "@/lib/time";

import { KINDS } from "./kinds";

const { Text, Paragraph } = Typography;

/** More tags than this and the card is a tag cloud rather than a summary. */
const SHOWN_KINDS = 5;

export function DashboardCard({
  dashboard,
  open,
  canCopy = false,
  onOpen,
  onCopy,
  onSettings,
  onDelete,
}: {
  dashboard: SavedDashboard;
  open: boolean;
  /** Whether this reader may own dashboards, and so may take a copy. */
  canCopy?: boolean;
  onOpen: () => void;
  onCopy?: () => void;
  onSettings: () => void;
  onDelete: () => void;
}) {
  const kinds = dashboard.widget_kinds.slice(0, SHOWN_KINDS);
  const hidden = dashboard.widget_kinds.length - kinds.length;

  return (
    // Not a `role="button"` on the whole card, which is what it was: a button
    // holding a Settings button and a Delete button is `nested-interactive` —
    // a screen reader announces one control and there are three, and the two
    // inside are unreachable by the name the outer one carries. The title is
    // the control now, and the card keeps its click for the mouse (§55).
    <div
      className={`nu-board-card${open ? " is-open" : ""}`}
      onClick={onOpen}
      data-testid={`board-card-${dashboard.id}`}
    >
      <div className="nu-board-head">
        <Space size={6} className="nu-board-title">
          <button
            type="button"
            className="nu-board-open"
            onClick={(event) => {
              // The card's own click would fire too, and opening twice is one
              // navigation and one wasted render.
              event.stopPropagation();
              onOpen();
            }}
          >
            <Text strong ellipsis>
              {dashboard.name}
            </Text>
          </button>
          {dashboard.is_home && (
            <Tooltip title="Your home dashboard">
              <HomeFilled aria-label="Your home dashboard" />
            </Tooltip>
          )}
        </Space>

        {/* Stopped from bubbling: the card itself is the open control, and a
            click on Delete that also opened the dashboard would be a delete
            confirmation over a page that just changed underneath it. */}
        <Space size={0} onClick={(event) => event.stopPropagation()}>
          {/* A colleague's layout, taken as your own. On the card rather than
              only inside the dashboard, because the gallery is where somebody
              is comparing layouts and deciding which one to work from. */}
          {!dashboard.can_edit && canCopy && onCopy && (
            <Tooltip title="Make a copy you can change">
              <Button
                type="text"
                size="small"
                aria-label={`Make a copy of ${dashboard.name}`}
                icon={<CopyOutlined />}
                onClick={onCopy}
              />
            </Tooltip>
          )}
          {dashboard.can_edit && (
            <>
            <Tooltip title="Settings and sharing">
              <Button
                type="text"
                size="small"
                aria-label={`Settings for ${dashboard.name}`}
                icon={<SettingOutlined />}
                onClick={onSettings}
              />
            </Tooltip>
            <Tooltip title="Delete">
              <Button
                type="text"
                size="small"
                danger
                aria-label={`Delete ${dashboard.name}`}
                icon={<DeleteOutlined />}
                onClick={onDelete}
              />
            </Tooltip>
            </>
          )}
        </Space>
      </div>

      <Paragraph type="secondary" className="nu-board-desc" ellipsis={{ rows: 2 }}>
        {dashboard.description ||
          `${dashboard.widget_count} ${dashboard.widget_count === 1 ? "widget" : "widgets"}`}
      </Paragraph>

      {/* What it holds. The whole reason this is a card. */}
      <div className="nu-board-kinds">
        {kinds.map((kind) => (
          // `KINDS` covers the whole `WidgetKind` union, and TypeScript
          // enforces that — so a kind the server sends is a kind this can
          // name, and a guard here would be unreachable.
          <EdgeTag key={kind} color={KINDS[kind].colour}>
            {KINDS[kind].label}
          </EdgeTag>
        ))}
        {hidden > 0 && <Tag bordered={false}>+{hidden}</Tag>}
        {dashboard.widget_kinds.length === 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Nothing on it yet
          </Text>
        )}
      </div>

      <div className="nu-board-foot">
        <Text type="secondary">{relativeTime(dashboard.updated_at)}</Text>
        <Space size={6}>
          {!dashboard.can_edit && (
            <Tooltip title={`Shared by ${dashboard.owner.name}`}>
              <Tag bordered={false} icon={<TeamOutlined />}>
                {dashboard.owner.name}
              </Tag>
            </Tooltip>
          )}
          {dashboard.can_edit && dashboard.scope !== "PRIVATE" && (
            <Tag bordered={false} color="processing">
              {dashboard.scope === "PUBLIC"
                ? "Everyone"
                : `${dashboard.members.length} shared`}
            </Tag>
          )}
        </Space>
      </div>
    </div>
  );
}
