import { Button, Skeleton } from "antd";
import { useNavigate } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { DropGap } from "@/components/kanban/useBoardDrag";
import { QuickCreate, SWIMLANE_FIELD } from "@/components/planning/BoardExtras";
import type { RecordEditing } from "@/components/records/useRecordEditing";

import { TaskCard } from "./TaskCard";
import { LaneHead } from "./LaneHead";
import type { TasksBoard } from "./useTasksBoard";

/**
 * One status lane — in one swimlane, when the board is split. Its heading says
 * what a drop will do; its list opens a slot where the card will land.
 */
export function TaskLane({
  model,
  lane,
  index,
  swimKey,
  records,
}: {
  model: TasksBoard;
  lane: { status: string; total: number };
  index: number;
  swimKey: string;
  records: RecordEditing;
}) {
  const navigate = useNavigate();
  const { swim, keyFor, laneQueries, rowsIn, board, carried, swimLabel, epicName, pending } = model;
  const key = keyFor(swimKey, lane.status);
  const query = laneQueries[index];
  const items = rowsIn(key);
  const total = query?.data?.total ?? lane.total;
  const drop = board.laneProps(key);
  const targeted = carried?.over.lane === key;
  // Dropping a card back where it came from changes nothing, and a
  // lane that lights up promising a move it will not make is worse
  // than one that stays quiet.
  const isSource =
    targeted && carried.from === key && carried.over.index === carried.origin;
  const reorder = targeted && carried.from === key && !isSource;

  return (
    <section
      className={`nu-lane nx-rec-lane ${drop.className}${
        targeted ? (isSource ? " nu-lane-source" : " nu-lane-over") : ""
      }`}
      data-drop-lane={drop["data-drop-lane"]}
      aria-label={swim === "none" ? lane.status : `${lane.status} · ${swimLabel(swimKey)}`}
      data-testid={swim === "none" ? `lane-${lane.status}` : `lane-${swimKey || "none"}-${lane.status}`}
    >
      <LaneHead
        status={lane.status}
        intent={targeted ? (isSource ? "noop" : reorder ? "reorder" : "move") : null}
        count={swim === "none" ? total.toLocaleString() : items.length}
        total={total}
      />

      {query?.isLoading ? (
        <Skeleton active title={false} paragraph={{ rows: 4 }} />
      ) : (
        <ul className="nu-lane-cards" data-drop-list={key}>
          {items.length === 0 && !targeted ? (
            <li className="nx-rec-lane-empty">
              <EmptyState compact title="Nothing here" />
            </li>
          ) : (
            board.renderLane(
              key,
              items,
              (task) => task.id,
              (task) => (
                <li key={task.id}>
                  <TaskCard
                    task={task}
                    lane={lane.status}
                    drag={board.cardProps(task.id, key)}
                    epicName={task.epic_id ? epicName.get(task.epic_id) : undefined}
                    saving={pending.includes(task.id)}
                    records={records}
                    onOpen={() => navigate(`/tasks/${task.id}`)}
                  />
                </li>
              ),
              (height) => (
                <DropGap
                  key="gap"
                  height={height}
                  label={isSource ? "back where it was" : "lands here"}
                />
              ),
            )
          )}
        </ul>
      )}

      {swim === "none" && total > items.length && (
        <Button
          type="text"
          block
          className="nx-rec-lane-more"
          onClick={() => navigate(`/explore?resource=task&f.status=${lane.status}`)}
        >
          All {total.toLocaleString()} in this lane
        </Button>
      )}
      {records.canCreate && (
        <QuickCreate
          status={lane.status}
          extra={swim !== "none" && swimKey ? { [SWIMLANE_FIELD[swim]]: swimKey } : undefined}
        />
      )}
    </section>
  );
}
