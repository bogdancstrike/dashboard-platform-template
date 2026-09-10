/**
 * One widget on the grid: its frame, its controls, and its place (§45).
 *
 * Split from `WidgetBody` because the two change for different reasons. The
 * body is about *what the widget shows* and follows the endpoint that answers
 * it; this is about *where the widget sits and what may be done to it*, and
 * follows the grid and the reader's permissions.
 *
 * **Three ways to move a card, one place it is written.** The pointer drags it
 * (`WidgetGrid`), the arrow keys nudge it when the card has focus, and the
 * menu names every move in words. `react-grid-layout` is pointer-only by
 * construction, and a layout only a mouse can change is a layout half the
 * readers cannot have (§54) — but a second implementation of "where is this
 * widget" would be worse than the problem. So all three call the same `moves`,
 * which writes the whole layout through one endpoint.
 *
 * **Arrow keys, because a menu is not a gesture.** "Move left" as a menu item
 * is four presses to shift a card two columns. Focusing the card and pressing
 * the arrow twice is two, and shift-arrow resizes — which is close enough to
 * the drag that somebody can do a whole layout from the keyboard without
 * feeling they took the long way round.
 */

import { Button, Card, Dropdown, Space, Tooltip, Typography } from "antd";
import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  ColumnWidthOutlined,
  DeleteOutlined,
  EditOutlined,
  ExpandOutlined,
  HolderOutlined,
} from "@ant-design/icons";
import type { KeyboardEvent, ReactNode } from "react";

import type { DashboardWidget } from "@/api/dashboards";

import { KINDS } from "./kinds";
import { SIZE_PRESETS } from "./WidgetGrid";

const { Text } = Typography;

/**
 * What may be done to one widget from the card itself.
 *
 * Deliberately *not* dragging: `WidgetGrid` owns that, with the pointer, and a
 * second drag implementation here would be two answers to "where is this
 * widget". What lives here is the keyboard path — the same moves, as keystrokes
 * and as menu items — because `react-grid-layout` is pointer-only by
 * construction and a layout only a mouse can change is a layout half the
 * readers cannot (§54).
 */
export interface WidgetMoves {
  /** Shift the widget one column or row. */
  nudge: (widget: DashboardWidget, dx: number, dy: number) => void;
  /** Widen or narrow it by one column, or make it taller or shorter. */
  resize: (widget: DashboardWidget, dWidth: number, dHeight: number) => void;
  /** Set it to an exact size — what the presets in the menu write. */
  setSize: (widget: DashboardWidget, width: number, height: number) => void;
  edit: (widget: DashboardWidget) => void;
  remove: (widget: DashboardWidget) => void;
}

/** One step of a nudge or a resize, per arrow key. */
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function WidgetCard({
  widget,
  editable,
  columns,
  moves,
  children,
}: {
  widget: DashboardWidget;
  editable: boolean;
  /** The grid's width, so a preset can be a fraction of it. */
  columns: number;
  moves: WidgetMoves;
  children: ReactNode;
}) {
  const spec = KINDS[widget.kind];

  /**
   * The keyboard half of the drag.
   *
   * Only when the *card* itself has focus: a chart's tooltip, a list's links
   * and the scrollable body all live inside, and stealing their arrow keys
   * would make the widget's own content unreachable. `event.target ===
   * event.currentTarget` is the whole guard, and it is what lets the scroll
   * region below keep its own arrow keys (§54, §55).
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!editable || event.target !== event.currentTarget) return;
    const step = ARROWS[event.key];
    if (!step) return;
    event.preventDefault();
    const [dx, dy] = step;
    if (event.shiftKey) moves.resize(widget, dx, dy);
    else moves.nudge(widget, dx, dy);
  };

  return (
    <div
      className="nu-widget"
      data-testid={`widget-${widget.id}`}
      // The size the *record* declares, stated in the DOM. The grid puts the
      // card in place with a transform, so nothing else on the page says how
      // many columns a widget was saved as — which is the thing a reader
      // changes and a test needs to read back.
      data-columns={widget.width}
      data-rows={widget.height}
      // Focusable only while the layout can change: a reading-mode dashboard
      // of fourteen cards would otherwise be fourteen tab stops that do
      // nothing.
      tabIndex={editable ? 0 : undefined}
      role={editable ? "group" : undefined}
      aria-label={
        editable
          ? `${widget.title} — ${widget.width} by ${widget.height}. Arrow keys move it, shift and arrow keys resize it.`
          : undefined
      }
      onKeyDown={onKeyDown}
    >
      <Card
        size="small"
        className="nu-widget-card"
        title={
          <Space size={6}>
            {editable ? (
              <Tooltip title="Drag the heading to move this card">
                <HolderOutlined className="nu-widget-grip" aria-hidden />
              </Tooltip>
            ) : (
              <span className="nu-widget-kind" style={{ color: spec.colour }} aria-hidden>
                {spec.icon}
              </span>
            )}
            <span>{widget.title}</span>
          </Space>
        }
        extra={
          editable ? (
            <Space size={2} className="nu-widget-nodrag">
              {/* Every gesture also a control: a grid only a pointer can
                  rearrange is a grid a keyboard cannot (§54). */}
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    { key: "left", icon: <ArrowLeftOutlined />, label: "Move left" },
                    { key: "right", icon: <ArrowRightOutlined />, label: "Move right" },
                    { key: "up", icon: <ArrowUpOutlined />, label: "Move up" },
                    { key: "down", icon: <ArrowDownOutlined />, label: "Move down" },
                    { type: "divider" },
                    { key: "wider", icon: <ColumnWidthOutlined />, label: "Wider" },
                    { key: "narrower", icon: <ColumnWidthOutlined />, label: "Narrower" },
                    { key: "taller", icon: <ArrowDownOutlined />, label: "Taller" },
                    { key: "shorter", icon: <ArrowUpOutlined />, label: "Shorter" },
                    { type: "divider" },
                    {
                      key: "size",
                      icon: <ExpandOutlined />,
                      label: "Set a size",
                      // The sizes somebody actually means, rather than the one
                      // they arrive at by dragging until the number is right.
                      children: SIZE_PRESETS.map((preset) => ({
                        key: `size:${preset.key}`,
                        label: preset.label,
                      })),
                    },
                  ],
                  onClick: ({ key, domEvent }) => {
                    domEvent.stopPropagation();
                    if (key.startsWith("size:")) {
                      const preset = SIZE_PRESETS.find(
                        (item) => item.key === key.slice("size:".length),
                      );
                      if (preset) {
                        moves.setSize(
                          widget,
                          Math.max(1, Math.round(columns * preset.fraction)),
                          // The height it already has, unless the preset is
                          // taller: a full-width card that shrank a chart to
                          // one row is a preset that undid somebody's work.
                          Math.max(widget.height, preset.rows),
                        );
                      }
                      return;
                    }
                    const step: Record<string, [number, number, number, number]> = {
                      left: [-1, 0, 0, 0],
                      right: [1, 0, 0, 0],
                      up: [0, -1, 0, 0],
                      down: [0, 1, 0, 0],
                      wider: [0, 0, 1, 0],
                      narrower: [0, 0, -1, 0],
                      taller: [0, 0, 0, 1],
                      shorter: [0, 0, 0, -1],
                    };
                    const [dx, dy, dw, dh] = step[key] ?? [0, 0, 0, 0];
                    if (dx || dy) moves.nudge(widget, dx, dy);
                    else moves.resize(widget, dw, dh);
                  },
                }}
              >
                <Button
                  type="text"
                  size="small"
                  aria-label={`Move or resize ${widget.title}`}
                  icon={<ColumnWidthOutlined />}
                />
              </Dropdown>
              <Tooltip title="Change what this shows">
                <Button
                  type="text"
                  size="small"
                  aria-label={`Configure ${widget.title}`}
                  icon={<EditOutlined />}
                  onClick={() => moves.edit(widget)}
                />
              </Tooltip>
              <Tooltip title="Remove from this dashboard">
                <Button
                  type="text"
                  size="small"
                  danger
                  aria-label={`Remove ${widget.title}`}
                  icon={<DeleteOutlined />}
                  onClick={() => moves.remove(widget)}
                />
              </Tooltip>
            </Space>
          ) : undefined
        }
      >
        {widget.subtitle && (
          <Text type="secondary" className="nu-widget-subtitle">
            {widget.subtitle}
          </Text>
        )}
        {/* The scroll lives on a focusable element, not on the card body.
            A region that scrolls and cannot be focused is a region a keyboard
            cannot reach the bottom of — which is most of a dashboard, since a
            widget is a fixed height and its contents are not (§54, §55). */}
        <div
          className="nu-widget-scroll"
          tabIndex={0}
          role="group"
          aria-label={widget.title}
        >
          {children}
        </div>
      </Card>
    </div>
  );
}
