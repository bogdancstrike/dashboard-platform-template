/**
 * One widget on the grid: its frame, its controls, and its place (§45).
 *
 * Split from `WidgetBody` because the two change for different reasons. The
 * body is about *what the widget shows* and follows the endpoint that answers
 * it; this is about *where the widget sits and what may be done to it*, and
 * follows the grid and the reader's permissions.
 *
 * The move and resize controls are buttons, not only drag handles. A grid that
 * can only be rearranged by dragging is a grid a keyboard cannot rearrange
 * (§54), and "nudge it left" is a clearer instruction than a pointer gesture
 * for anybody who has ever fought a drop target.
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
  HolderOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

import type { DashboardWidget } from "@/api/dashboards";

const { Text } = Typography;

/**
 * What may be done to one widget from the card itself.
 *
 * Deliberately *not* dragging: `WidgetGrid` owns that, with the pointer, and a
 * second drag implementation here would be two answers to "where is this
 * widget". What lives here is the keyboard path — the same moves, as menu
 * items — because `react-grid-layout` is pointer-only by construction and a
 * layout only a mouse can change is a layout half the readers cannot (§54).
 */
export interface WidgetMoves {
  /** Shift the widget one column or row. */
  nudge: (widget: DashboardWidget, dx: number, dy: number) => void;
  /** Widen or narrow it by one column, or make it taller or shorter. */
  resize: (widget: DashboardWidget, dWidth: number, dHeight: number) => void;
  edit: (widget: DashboardWidget) => void;
  remove: (widget: DashboardWidget) => void;
}

export function WidgetCard({
  widget,
  editable,
  moves,
  children,
}: {
  widget: DashboardWidget;
  editable: boolean;
  moves: WidgetMoves;
  children: ReactNode;
}) {
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
    >
      <Card
        size="small"
        className="nu-widget-card"
        title={
          <Space size={6}>
            {editable && <HolderOutlined className="nu-widget-grip" aria-hidden />}
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
                  ],
                  onClick: ({ key, domEvent }) => {
                    domEvent.stopPropagation();
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
