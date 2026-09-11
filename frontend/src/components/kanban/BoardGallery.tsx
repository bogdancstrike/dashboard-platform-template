/**
 * What a reader sees when the address names no board (§18, §45).
 *
 * A gallery of cards rather than a select, for the same reason the dashboard
 * gallery is: what somebody is choosing between is not a *name*, it is a
 * board — so each card carries what is on it. "5 lanes · 30 cards · public"
 * is recognised far faster than a row in a list, and a select would give the
 * choice one line of the page and make every board look identical.
 *
 * Reached rarely, which is the point: the page opens on the first board this
 * reader can see, so the gallery is for switching and for the first visit.
 */

import { Button, Card, Tag, Tooltip, Typography } from "antd";
import { GlobalOutlined, LockOutlined, PlusOutlined, TeamOutlined } from "@ant-design/icons";

import type { KanbanBoard } from "@/api/kanban";
import { EmptyState } from "@/components/EmptyState";
import { relativeTime } from "@/lib/time";

const { Text } = Typography;

/** What each visibility looks like, so the state is read rather than deduced. */
const SCOPES: Record<string, { icon: React.ReactNode; label: string }> = {
  PRIVATE: { icon: <LockOutlined />, label: "Only you" },
  SHARED: { icon: <TeamOutlined />, label: "Named people" },
  PUBLIC: { icon: <GlobalOutlined />, label: "Everyone signed in" },
};

export function BoardGallery({
  boards,
  canCreate,
  onOpen,
  onCreate,
}: {
  boards: KanbanBoard[];
  canCreate: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  if (boards.length === 0) {
    return (
      <Card size="small" data-testid="board-gallery">
        <EmptyState
          title="No boards yet"
          hint="A board is a workspace whose columns are yours to name — unlike the task board, whose lanes are the platform's."
          action={
            canCreate ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
                Create the first one
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <div className="nu-boards" data-testid="board-gallery">
      {boards.map((board) => {
        const scope = SCOPES[board.scope] ?? SCOPES["PRIVATE"]!;
        return (
          <Card
            key={board.id}
            size="small"
            hoverable
            className="nu-board-card"
            onClick={() => onOpen(board.id)}
            data-testid={`board-${board.id}`}
          >
            <div className="nu-board-card-head">
              <Tag bordered={false}>{board.key}</Tag>
              <Tooltip title={scope.label}>
                <span aria-label={scope.label}>{scope.icon}</span>
              </Tooltip>
            </div>

            <Text strong className="nu-board-card-name">
              {board.name}
            </Text>
            {board.description && (
              <Text type="secondary" className="nu-board-card-note" ellipsis>
                {board.description}
              </Text>
            )}

            <div className="nu-board-card-foot">
              {/* What is *on* it, which is what a reader is choosing between. */}
              <Text type="secondary">
                {board.lane_count} lane{board.lane_count === 1 ? "" : "s"}
                {board.card_count !== undefined
                  ? ` · ${board.card_count} card${board.card_count === 1 ? "" : "s"}`
                  : ""}
              </Text>
              <Text type="secondary">{relativeTime(board.updated_at)}</Text>
            </div>
          </Card>
        );
      })}

      {canCreate && (
        <button type="button" className="nu-board-new" onClick={onCreate} data-testid="gallery-new">
          <PlusOutlined />
          <span>New board</span>
        </button>
      )}
    </div>
  );
}