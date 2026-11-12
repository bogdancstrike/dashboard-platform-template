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

const { Text } = Typography;

/** More tags than this and the card is a tag cloud rather than a summary. */
const SHOWN_KINDS = 5;

/**
 * A small picture of the layout, drawn from the kinds it holds: a chart is a
 * row of bars, a number is a tinted block, a list is a blank slip. Not the
 * real geometry — the listing does not carry it — but enough to tell a wall
 * of numbers from a page of charts at a glance, which is what the gallery is
 * for.
 */
function BoardThumb({ kinds }: { kinds: SavedDashboard["widget_kinds"] }) {
  const tiles = kinds.slice(0, 6);
  return (
    <div className="nx-ov-thumb" aria-hidden="true">
      {tiles.map((kind, index) => {
        const family = KINDS[kind].family;
        const wide = index % 3 === 0;
        return (
          <span
            key={`${kind}-${index}`}
            className={`nx-ov-thumb-tile nx-ov-thumb-tile--${family}${wide ? " is-wide" : ""}`}
          >
            {family === "chart" && (
              <>
                <i style={{ height: "38%" }} />
                <i style={{ height: "62%" }} />
                <i style={{ height: "48%" }} />
                <i style={{ height: "86%" }} />
              </>
            )}
          </span>
        );
      })}
      {tiles.length === 0 && <span className="nx-ov-thumb-tile is-wide nx-ov-thumb-tile--empty" />}
    </div>
  );
}

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
      <BoardThumb kinds={dashboard.widget_kinds} />
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

      {/* What it holds, as a picture of the layout and as words. The tags
          stay, smaller: a reader recognises "alerts, revenue, a heatmap"
          faster than "7 widgets", and the thumbnail alone says nothing to a
          screen reader. */}
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
        <Text
          type="secondary"
          className="nx-ov-board-meta"
          ellipsis={{ tooltip: dashboard.description || undefined }}
        >
          {[
            dashboard.can_edit ? "You" : dashboard.owner.name,
            !dashboard.can_edit ? "shared with you" : "",
            `${dashboard.widget_count} ${dashboard.widget_count === 1 ? "widget" : "widgets"}`,
            relativeTime(dashboard.updated_at),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <Space size={6}>
          {!dashboard.can_edit && (
            <Tooltip title={`Shared by ${dashboard.owner.name}`}>
              <Tag bordered={false} icon={<TeamOutlined />} className="nx-ov-pill nx-ov-pill--accent">
                Shared
              </Tag>
            </Tooltip>
          )}
          {dashboard.can_edit && dashboard.scope !== "PRIVATE" && (
            <Tag bordered={false} className="nx-ov-pill nx-ov-pill--accent">
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
