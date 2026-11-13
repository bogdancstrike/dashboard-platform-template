import { Alert, Card, Skeleton } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { ApiError } from "@/api/client";
import { LaneColumn } from "@/components/kanban/LaneColumn";
import { EmptyState } from "@/components/EmptyState";

import type { KanbanPageModel } from "./useKanbanPage";

/** The lanes, the add-lane tile, and what the board says when it has nothing on it. */
export function BoardLanes({ m, filtered }: { m: KanbanPageModel; filtered: boolean }) {
  const { setNamingLane, setOpenCard, board, detail, canEdit, move, drag, editLane, dropLane, addCard } = m;
  return (
    <>
      {board.isLoading && !detail ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : board.isError ? (
        <Alert
          type="error"
          showIcon
          message={
            board.error instanceof ApiError
              ? board.error.message
              : "That board could not be opened."
          }
        />
      ) : (
        <>
          {detail && detail.unplaced.length > 0 && (
            <Alert
              className="nu-block"
              type="warning"
              showIcon
              message={`${detail.unplaced.length} card${detail.unplaced.length === 1 ? "" : "s"} in no lane`}
              description="A lane was removed while this page was open. Drag them somewhere."
            />
          )}

          {drag.overlay}
          <div className="nu-board nx-rec-kboard" data-testid="kanban-board" data-drag-scroll>
            {(detail?.lanes ?? []).map((lane) => (
              <LaneColumn
                key={lane.id}
                lane={lane}
                canEdit={canEdit}
                board={drag}
                onOpenCard={setOpenCard}
                onMove={(cardId, position) =>
                  move.mutate({ id: cardId, laneId: lane.id, position })
                }
                // The keyboard route and the drag go through one mutation:
                // two calls would be two behaviours, and the one nobody
                // uses by hand is the one that breaks unnoticed (§64).
                onMoveToLane={(cardId, laneId) =>
                  move.mutate({ id: cardId, laneId, position: 0 })
                }
                onAddCard={(title) => addCard.mutate({ laneId: lane.id, title })}
                onChange={(input) => editLane.mutate({ id: lane.id, input })}
                onRemove={(moveTo) => dropLane.mutate({ id: lane.id, moveTo })}
                others={(detail?.lanes ?? []).filter((item) => item.id !== lane.id)}
              />
            ))}

            {canEdit && (
              <button
                type="button"
                className="nu-lane-add"
                onClick={() => setNamingLane(true)}
                data-testid="add-lane"
              >
                <PlusOutlined />
                <span>Add a lane</span>
              </button>
            )}
          </div>

          {detail && detail.lanes.every((lane) => lane.cards.length === 0) && (
            <Card size="small" className="nu-block">
              <EmptyState
                title={filtered ? "Nothing matches those filters" : "This board is empty"}
                hint={
                  filtered
                    ? "Clear a filter, or search for something else."
                    : "Add a card to a lane — an epic to plan with, or a task to get on with."
                }
              />
            </Card>
          )}
        </>
      )}
    </>
  );
}
