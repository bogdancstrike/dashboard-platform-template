/**
 * The four questions somebody opens the notification centre with (§17).
 *
 * A list of forty rows answers "what happened" and nothing else. These answer
 * *how bad, how much, and what needs me* before the reader has scrolled — and
 * each tile is the filter for the thing it counts, so the summary and the way
 * to act on it are the same control rather than a number beside a search box.
 *
 * Every count is the **server's**, over the whole mailbox rather than the page
 * that happens to be loaded. "4 critical" derived in the browser would mean
 * "4 critical among these twenty-five", which is wrong exactly when there are
 * many, which is when it matters.
 */

import { Card, Space, Typography } from "antd";
import {
  AlertOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

import type { NotificationCounts } from "@/api/notifications";
import { SEMANTIC } from "@/theme/tokens";

const { Text } = Typography;

interface Tile {
  key: string;
  label: string;
  hint: string;
  value: number;
  icon: ReactNode;
  color: string;
  /** What clicking it filters the list down to. */
  filter: Record<string, string | null>;
}

export function NotificationDigest({
  counts,
  active,
  onFilter,
}: {
  counts: NotificationCounts | undefined;
  /** The tile whose filter is currently applied, if any. */
  active: string | null;
  onFilter: (filter: Record<string, string | null>) => void;
}) {
  const severity = counts?.by_severity ?? {};
  const category = counts?.by_category ?? {};

  const tiles: Tile[] = [
    {
      key: "unread",
      label: "Unread",
      hint: "waiting for you",
      value: counts?.unread ?? 0,
      icon: <InboxOutlined />,
      color: "var(--nu-accent)",
      filter: { read: "unread", severity: null, category: null },
    },
    {
      key: "critical",
      label: "Critical",
      hint: "unread, highest severity",
      value: severity["CRITICAL"] ?? 0,
      icon: <AlertOutlined />,
      color: SEMANTIC.danger,
      filter: { read: "unread", severity: "CRITICAL", category: null },
    },
    {
      key: "needs-you",
      label: "Needs you",
      hint: "approvals and assignments",
      value: (category["APPROVAL"] ?? 0) + (category["ASSIGNMENT"] ?? 0),
      icon: <CheckCircleOutlined />,
      color: SEMANTIC.warning,
      filter: { read: "unread", category: "APPROVAL,ASSIGNMENT", severity: null },
    },
    {
      key: "recent",
      label: "Last 24 hours",
      hint: "arrived while you were away",
      value: counts?.recent ?? 0,
      icon: <ClockCircleOutlined />,
      color: SEMANTIC.info,
      filter: { read: "unread", severity: null, category: null },
    },
  ];

  return (
    <div className="nu-digest" data-testid="notification-digest">
      {tiles.map((tile) => (
        <Card
          key={tile.key}
          size="small"
          className={`nu-digest-tile${active === tile.key ? " is-active" : ""}`}
          // A tile with nothing in it is still shown — "0 critical" is
          // information, and a strip that changes shape as counts move is one
          // the eye has to re-learn every visit.
          onClick={() => onFilter(tile.filter)}
          role="button"
          tabIndex={0}
          aria-pressed={active === tile.key}
          aria-label={`${tile.value} ${tile.label} — ${tile.hint}`}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onFilter(tile.filter);
            }
          }}
        >
          <Space size={10} align="start">
            <span className="nu-digest-icon" style={{ color: tile.color }} aria-hidden>
              {tile.icon}
            </span>
            <Space direction="vertical" size={0}>
              <span className="nu-digest-value" style={{ color: tile.value ? tile.color : undefined }}>
                {tile.value.toLocaleString()}
              </span>
              <Text className="nu-digest-label">{tile.label}</Text>
              <Text type="secondary" className="nu-digest-hint">
                {tile.hint}
              </Text>
            </Space>
          </Space>
        </Card>
      ))}
    </div>
  );
}
