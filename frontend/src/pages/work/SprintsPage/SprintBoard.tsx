import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, App as AntApp } from "antd";

import { ApiError } from "@/api/client";
import { type SprintCard, type SprintDetail } from "@/api/planning";
import { taskBoardApi } from "@/api/taskBoard";
import { EmptyState } from "@/components/EmptyState";
import { StatusTag } from "@/components/StatusTag";
import { DropGap, useBoardDrag } from "@/components/kanban/useBoardDrag";
import { Points } from "@/components/planning/PlanItem";
import { knownStatusColor } from "@/theme/tokens";
import { queryKeys } from "@/lib/queryKeys";

import { BOARD_LANES } from "./constants";

/** The running sprint as a board: status lanes, the task board's drag and write. */
export function SprintBoard({ sprint, onOpen, onChanged }: { sprint: SprintDetail; onOpen: (id: string) => void; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const byLane = (lane: string) =>
    sprint.tasks.filter((task) => task.status === lane).sort((a, b) => a.board_position - b.board_position);

  const move = useMutation({
    mutationFn: ({ task, to, after, before }: { task: SprintCard; to: string; index: number; after: string | null; before: string | null }) =>
      taskBoardApi.place(task.id, { status: to, after_id: after, before_id: before, expected_updated_at: task.updated_at }),
    onMutate: async ({ task, to, index }) => {
      const key = queryKeys.sprint(sprint.id);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      const lane = byLane(to).filter((item) => item.id !== task.id);
      const above = lane[index - 1]?.board_position;
      const below = lane[index]?.board_position;
      const rank = above !== undefined && below !== undefined ? (above + below) / 2 : above !== undefined ? above + 1 : below !== undefined ? below - 1 : 0;
      queryClient.setQueryData<SprintDetail>(key, (current) =>
        current
          ? { ...current, tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, status: to, board_position: rank } : item)) }
          : current,
      );
      return { previous, key };
    },
    onError: (error, _vars, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
      message.error(error instanceof ApiError ? error.message : "That move could not be saved.");
    },
    onSettled: () => {
      onChanged();
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskLane() });
    },
  });

  const cards = new Map(sprint.tasks.map((task) => [task.id, task]));
  const drag = useBoardDrag({
    enabled: sprint.can_manage,
    lanes: BOARD_LANES,
    items: (lane) => byLane(lane).map((task) => task.id),
    onDrop: (id, _from, to) => {
      const task = cards.get(id);
      if (!task) return;
      const rest = byLane(to.lane).filter((item) => item.id !== id);
      move.mutate({ task, to: to.lane, index: to.index, after: rest[to.index - 1]?.id ?? null, before: rest[to.index]?.id ?? null });
    },
    describe: (id) => `${cards.get(id)?.reference ?? ""} ${cards.get(id)?.title ?? ""}`.trim(),
    laneName: (lane) => lane.replace(/_/g, " ").toLowerCase(),
  });

  const pct = sprint.total_points ? Math.round((sprint.done_points / sprint.total_points) * 100) : 0;
  return (
    <>
      <div className="nx-pl-kpis" data-testid="sprint-kpis">
        <div className="nx-pl-kpi">
          <span>Days left</span>
          <strong>{sprint.days_left ?? "—"}</strong>
        </div>
        <div className="nx-pl-kpi">
          <span>Committed</span>
          <strong>
            {sprint.committed_points ?? sprint.total_points}
            <em>pts</em>
          </strong>
        </div>
        <div className="nx-pl-kpi">
          <span>Done</span>
          <strong>
            {sprint.done_points}
            <em>{pct}%</em>
          </strong>
        </div>
        <div className="nx-pl-kpi">
          <span>Remaining</span>
          <strong>
            {sprint.remaining_points}
            <em>pts</em>
          </strong>
        </div>
      </div>
      {sprint.goal && <Alert className="nu-block" type="info" showIcon message={`Goal: ${sprint.goal}`} />}
      <div className="nu-board nx-rec-board" data-testid="sprint-board" data-drag-scroll>
        {BOARD_LANES.map((lane) => {
          const items = byLane(lane);
          const props = drag.laneProps(lane);
          const points = items.reduce((sum, item) => sum + (item.story_points ?? 0), 0);
          return (
            <section key={lane} className={`nu-lane nx-rec-lane ${props.className}`} data-drop-lane={lane} aria-label={lane} data-testid={`sprint-lane-${lane}`}>
              <header className="nu-lane-head">
                <span className="nu-lane-dot" style={{ background: knownStatusColor(lane) ?? "var(--nu-border-strong)" }} aria-hidden />
                <span className="nu-lane-title">{lane.replace(/_/g, " ")}</span>
                <span className="nu-lane-count">
                  {items.length} · {points} pts
                </span>
              </header>
              <ul className="nu-lane-cards" data-drop-list={lane}>
                {items.length === 0 && drag.drag?.over.lane !== lane ? (
                  <li className="nx-rec-lane-empty">
                    <EmptyState compact title="Nothing here" />
                  </li>
                ) : (
                  drag.renderLane(
                    lane,
                    items,
                    (item) => item.id,
                    (item) => {
                      const { className, ...handlers } = drag.cardProps(item.id, lane);
                      return (
                        <li key={item.id}>
                          <article
                            {...handlers}
                            className={`nu-task-card nx-rec-card ${className}`}
                            data-testid={`sprint-card-${item.reference}`}
                            aria-label={`${item.reference} ${item.title}`}
                            onClick={() => onOpen(item.id)}
                          >
                            {item.cover_color && <span className="nx-pl-cover" style={{ ["--nx-pl-tone" as string]: item.cover_color }} />}
                            <div className="nx-rec-card-top">
                              <StatusTag status={item.priority} />
                              <span className="nu-task-ref">{item.reference}</span>
                              <span className="nx-rec-spacer" />
                              <Points value={item.story_points} />
                            </div>
                            <span className="nu-task-title">{item.title}</span>
                            {item.blocked_reason && <span className="nx-pl-flag">⚑ {item.blocked_reason}</span>}
                            <span className="nu-task-meta">
                              {item.checklist_total > 0 && (
                                <span>
                                  ☑ {item.checklist_done}/{item.checklist_total}
                                </span>
                              )}
                              <span className="nx-rec-spacer" />
                              {item.assignee && <span className="nx-pl-who">{item.assignee.initials}</span>}
                            </span>
                          </article>
                        </li>
                      );
                    },
                    (height) => <DropGap key="gap" height={height} label="lands here" />,
                  )
                )}
              </ul>
            </section>
          );
        })}
      </div>
      {drag.overlay}
    </>
  );
}
