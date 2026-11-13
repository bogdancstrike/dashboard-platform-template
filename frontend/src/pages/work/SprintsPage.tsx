/**
 * `/sprints` — backlog, sprint planning, the running sprint's board, and how
 * the sprints went (§18). Jira's and Taiga's shape, over the one work queue.
 *
 * **Planning is dragging.** The backlog and every open sprint are drop lists on
 * one drag engine (`useBoardDrag`, the board's): a task dropped into a sprint
 * joins it, one dropped back leaves it, and the order inside each list is a
 * hand-made rank the server keeps — a drop writes one row.
 *
 * **The board is the task board's**, narrowed to the running sprint: lanes are
 * the status vocabulary and a drop is the same `place` write `/tasks` makes.
 *
 * **Reports** are the burndown (daily snapshots against the ideal line), the
 * velocity across the last sprints, and what each completed sprint delivered,
 * carried over and absorbed after it started.
 *
 * The project is a filter (replaced in the address); the tab and the sprint a
 * report shows are places (pushed), so back walks them.
 */

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App as AntApp, Button, Card, Dropdown, Grid, Input, Segmented, Select, Skeleton, Space, Tag, Tooltip } from "antd";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { planningApi, type Sprint, type SprintCard, type SprintDetail } from "@/api/planning";
import { taskBoardApi } from "@/api/taskBoard";
import { EmptyState } from "@/components/EmptyState";
import { FailureAlert } from "@/components/FailureAlert";
import { PageHeader } from "@/components/PageHeader";
import { StatusTag } from "@/components/StatusTag";
import { DropGap, useBoardDrag } from "@/components/kanban/useBoardDrag";
import { PlanItem, Points } from "@/components/planning/PlanItem";
import { BurndownChart, VelocityChart } from "@/components/planning/SprintCharts";
import { CompleteSprintModal, SprintFormModal, type SprintValues } from "@/components/planning/SprintModals";
import { shortDate } from "@/components/planning/gantt";
import { projectOptions, useProjects } from "@/components/planning/useProjects";
import { useUrlState } from "@/components/planning/useUrlState";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { knownStatusColor } from "@/theme/tokens";
import "@/styles/planning.css";
import { queryKeys } from "@/lib/queryKeys";

const BACKLOG = "backlog";
const BOARD_LANES = ["NEW", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE"];
type Tab = "plan" | "board" | "reports";

export default function SprintsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const screens = Grid.useBreakpoint();
  const { params, set } = useUrlState(["tab", "sprint"]);
  const projects = useProjects();
  const [term, setTerm] = useState("");
  const search = useDebouncedValue(term, 300);
  const [editing, setEditing] = useState<{ mode: "create" | "edit" | "start"; sprint: Sprint | null } | null>(null);
  const [completing, setCompleting] = useState<Sprint | null>(null);

  const tab = (["plan", "board", "reports"].includes(params.get("tab") ?? "") ? params.get("tab") : "plan") as Tab;

  // With no project in the address, the one whose sprint is running.
  const running = useQuery({
    queryKey: queryKeys.sprints("active-any"),
    queryFn: ({ signal }) => planningApi.sprints({ state: "ACTIVE" }, signal),
    enabled: !params.get("project"),
  });
  const project = params.get("project") ?? running.data?.items[0]?.project?.id ?? "";

  const sprints = useQuery({
    queryKey: queryKeys.sprints(project),
    queryFn: ({ signal }) => planningApi.sprints({ project_id: project || undefined }, signal),
    enabled: Boolean(project) || running.isSuccess,
  });
  const all = sprints.data?.items ?? [];
  const open = all.filter((item) => item.state !== "COMPLETED");
  const active = all.find((item) => item.state === "ACTIVE") ?? null;
  const canManage = sprints.data?.can_manage ?? false;

  const details = useQueries({
    queries: open.map((item) => ({
      queryKey: queryKeys.sprint(item.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => planningApi.sprint(item.id, signal),
    })),
  });
  const byId = new Map<string, SprintDetail>();
  details.forEach((query) => query.data && byId.set(query.data.id, query.data));

  const backlog = useQuery({
    queryKey: queryKeys.backlog(project, search),
    queryFn: ({ signal }) => planningApi.backlog({ project_id: project || undefined, q: search || undefined }, signal),
    enabled: Boolean(project) || running.isSuccess,
  });
  const epics = useQuery({
    queryKey: queryKeys.epics(project),
    queryFn: ({ signal }) => planningApi.epics({ project_id: project || undefined }, signal),
    enabled: Boolean(project),
  });
  const epicName = useMemo(() => new Map((epics.data?.items ?? []).map((epic) => [epic.id, epic.title])), [epics.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sprints() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sprint() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.backlog() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.velocity() });
  };
  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : "That could not be saved.");

  // ── planning: the backlog and the open sprints are one drag surface ──
  const listOf = (lane: string): SprintCard[] =>
    lane === BACKLOG ? backlog.data?.items ?? [] : [...(byId.get(lane)?.tasks ?? [])].sort((a, b) => a.backlog_rank - b.backlog_rank);
  const lanes = [...open.map((item) => item.id), BACKLOG];
  const cards = new Map<string, SprintCard>();
  for (const lane of lanes) for (const card of listOf(lane)) cards.set(card.id, card);

  const plan = useMutation({
    mutationFn: (input: { task: SprintCard; to: string; index: number; after_id: string | null; before_id: string | null }) =>
      planningApi.place({
        task_id: input.task.id,
        sprint_id: input.to === BACKLOG ? null : input.to,
        after_id: input.after_id,
        before_id: input.before_id,
      }),
    onMutate: async ({ task, to, index }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.sprint() });
      await queryClient.cancelQueries({ queryKey: queryKeys.backlog() });
      const from = task.sprint_id ?? BACKLOG;
      const keyOf = (lane: string) => (lane === BACKLOG ? queryKeys.backlog(project, search) : queryKeys.sprint(lane));
      const previous = [from, to].map((lane) => [keyOf(lane), queryClient.getQueryData(keyOf(lane))] as const);
      const without = (lane: string) => listOf(lane).filter((item) => item.id !== task.id);
      const target = without(to);
      const rankBefore = target[index - 1]?.backlog_rank;
      const rankAfter = target[index]?.backlog_rank;
      const rank =
        rankBefore !== undefined && rankAfter !== undefined
          ? (rankBefore + rankAfter) / 2
          : rankBefore !== undefined
            ? rankBefore + 1
            : rankAfter !== undefined
              ? rankAfter - 1
              : 0;
      const moved = { ...task, sprint_id: to === BACKLOG ? null : to, backlog_rank: rank };
      const write = (lane: string, items: SprintCard[]) =>
        queryClient.setQueryData(keyOf(lane), (current: unknown) => {
          if (!current) return current;
          return lane === BACKLOG ? { ...(current), items } : { ...(current), tasks: items };
        });
      if (from !== to) write(from, without(from));
      write(to, [...target.slice(0, index), moved, ...target.slice(index)]);
      return { previous };
    },
    onError: (error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
      failed(error);
    },
    onSettled: refresh,
  });

  const drag = useBoardDrag({
    enabled: canManage,
    lanes,
    items: (lane) => listOf(lane).map((item) => item.id),
    onDrop: (id, _from, to) => {
      const task = cards.get(id);
      if (!task) return;
      const rest = listOf(to.lane).filter((item) => item.id !== id);
      plan.mutate({
        task,
        to: to.lane,
        index: to.index,
        after_id: rest[to.index - 1]?.id ?? null,
        before_id: rest[to.index]?.id ?? null,
      });
    },
    describe: (id) => {
      const card = cards.get(id);
      return card ? `${card.reference} ${card.title}` : "the task";
    },
    laneName: (lane) => (lane === BACKLOG ? "the backlog" : all.find((item) => item.id === lane)?.name ?? "the sprint"),
  });

  // ── sprint lifecycle ──
  const save = useMutation({
    mutationFn: async ({ mode, sprint, values }: { mode: "create" | "edit" | "start"; sprint: Sprint | null; values: SprintValues }) => {
      if (mode === "create") return planningApi.createSprint({ project_id: project || null, ...values, name: values.name || undefined });
      if (mode === "start") {
        return planningApi.startSprint(sprint!.id, {
          start_date: values.start_date ?? undefined,
          end_date: values.end_date ?? undefined,
          goal: values.goal ?? undefined,
        });
      }
      return planningApi.updateSprint(sprint!.id, values as unknown as Record<string, unknown>);
    },
    onSuccess: (saved, { mode }) => {
      message.success(mode === "create" ? `${saved.name} planned` : mode === "start" ? `${saved.name} started` : "Sprint saved");
      setEditing(null);
      if (mode === "start") set({ tab: "board" });
    },
    onError: failed,
    onSettled: refresh,
  });

  const complete = useMutation({
    mutationFn: ({ sprint, carry }: { sprint: Sprint; carry: "backlog" | "next" | "new" }) =>
      planningApi.completeSprint(sprint.id, carry),
    onSuccess: (done) => {
      message.success(`${done.name} completed — ${done.report.completed.length} done, ${done.report.carried_over.length} carried over`);
      setCompleting(null);
      set({ tab: "reports", sprint: done.id });
    },
    onError: failed,
    onSettled: refresh,
  });

  const remove = (sprint: Sprint) => {
    modal.confirm({
      title: `Delete ${sprint.name}?`,
      content: "Its tasks go back to the backlog. A sprint that has started cannot be deleted — complete it instead.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: () =>
        planningApi
          .removeSprint(sprint.id)
          .then(() => message.success(`${sprint.name} deleted`))
          .catch(failed)
          .finally(refresh),
    });
  };

  usePageCommands("sprints", [
    { id: "sprints.new", label: "Plan a new sprint", keywords: "create iteration", run: () => setEditing({ mode: "create", sprint: null }) },
    { id: "sprints.board", label: "Open the running sprint's board", keywords: "active kanban", run: () => set({ tab: "board" }) },
    { id: "sprints.burndown", label: "Show the burndown and velocity", keywords: "report chart", run: () => set({ tab: "reports" }) },
  ]);

  const hasNext = open.some((item) => item.state === "PLANNED");
  const loading = sprints.isLoading || (running.isLoading && !params.get("project"));

  return (
    <>
      <PageHeader
        title={
          <>
            Sprint <em>planning</em>
          </>
        }
        subtitle="A ranked backlog, time boxes drawn from it, and how each one went."
        actions={
          <>
            <Select
              showSearch
              optionFilterProp="label"
              aria-label="Project"
              data-testid="sprints-project"
              placeholder="Choose a project"
              style={{ minWidth: screens.md ? 260 : 170 }}
              loading={projects.isLoading}
              value={project || undefined}
              onChange={(value: string) => set({ project: value, sprint: null })}
              options={projectOptions(projects.data)}
            />
            <Tooltip title={canManage ? "" : "Your role does not include tasks.manage"}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canManage}
                onClick={() => setEditing({ mode: "create", sprint: null })}
                data-testid="sprint-new"
              >
                New sprint
              </Button>
            </Tooltip>
          </>
        }
      />

      <div className="nx-pl-toolbar">
        <Segmented
          aria-label="View"
          value={tab}
          onChange={(value) => set({ tab: value === "plan" ? null : String(value) })}
          options={[
            { value: "plan", label: "Backlog & planning" },
            { value: "board", label: active ? `Board · ${active.name.replace(/^.*?(Sprint)/, "$1")}` : "Board" },
            { value: "reports", label: "Reports" },
          ]}
          data-testid="sprints-tabs"
        />
        <span className="nx-pl-spacer" />
        {active && (
          <span className="nx-pl-legend">
            <StatusTag status="ACTIVE" label="Running" /> {active.name} · {active.days_left ?? 0} days left
          </span>
        )}
      </div>

      {sprints.isError ? (
        <FailureAlert error={sprints.error} onRetry={() => void sprints.refetch()} />
      ) : loading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : tab === "plan" ? (
        <div className="nx-pl-sprint-grid" data-testid="sprint-planning">
          <div>
            {open.length === 0 && (
              <Card className="nx-pl-sprint">
                <EmptyState
                  title="No sprint planned"
                  hint="Plan one, then drag work into it from the backlog."
                  action={
                    canManage ? (
                      <Button type="primary" onClick={() => setEditing({ mode: "create", sprint: null })}>
                        Plan a sprint
                      </Button>
                    ) : undefined
                  }
                />
              </Card>
            )}
            {open.map((sprint) => {
              const detail = byId.get(sprint.id);
              const items = listOf(sprint.id);
              const points = items.reduce((sum, item) => sum + (item.story_points ?? 0), 0);
              const capacity = sprint.capacity_points;
              const over = capacity !== null && points > capacity;
              const lane = drag.laneProps(sprint.id);
              return (
                <Card key={sprint.id} className={`nx-pl-sprint nx-pl-dropzone ${lane.className}`} data-drop-lane={lane["data-drop-lane"]} data-testid={`sprint-${sprint.name}`}>
                  <div className="nx-pl-sprint-head">
                    <span className="nx-pl-sprint-name">{sprint.name}</span>
                    <StatusTag status={sprint.state} label={sprint.state === "ACTIVE" ? "Running" : "Planned"} />
                    <span className="nx-pl-spacer" />
                    {canManage && sprint.state === "PLANNED" && (
                      <Button type={active ? "default" : "primary"} disabled={Boolean(active)} onClick={() => setEditing({ mode: "start", sprint })} data-testid={`sprint-start-${sprint.name}`}>
                        Start
                      </Button>
                    )}
                    {canManage && sprint.state === "ACTIVE" && (
                      <Button type="primary" onClick={() => setCompleting(sprint)} data-testid={`sprint-complete-${sprint.name}`}>
                        Complete
                      </Button>
                    )}
                    {canManage && (
                      <Dropdown
                        trigger={["click"]}
                        menu={{
                          items: [
                            { key: "edit", label: "Edit" },
                            ...(sprint.state === "PLANNED" ? [{ key: "delete", label: "Delete", danger: true }] : []),
                          ],
                          onClick: ({ key }) => {
                            if (key === "edit") setEditing({ mode: "edit", sprint });
                            else remove(sprint);
                          },
                        }}
                      >
                        <Button type="text" icon={<MoreOutlined />} aria-label={`More for ${sprint.name}`} />
                      </Dropdown>
                    )}
                  </div>
                  <div className="nx-pl-sprint-meta">
                    <span>
                      {sprint.start_date ? shortDate(sprint.start_date) : "No start"} – {sprint.end_date ? shortDate(sprint.end_date) : "no end"}
                    </span>
                    <span>{items.length} tasks</span>
                    {sprint.state === "ACTIVE" && <span>{sprint.done_points} of {sprint.total_points} pts done</span>}
                  </div>
                  {sprint.goal && <p className="nx-pl-sprint-goal">{sprint.goal}</p>}
                  <div className={`nx-pl-capacity${over ? " is-over" : ""}`} aria-label={`${points} of ${capacity ?? "no"} capacity points`}>
                    <span>
                      <strong>{points}</strong> pts{capacity !== null ? ` of ${capacity}` : ""}
                    </span>
                    {capacity !== null && (
                      <span className="nx-pl-capacity-bar">
                        <i style={{ width: `${Math.min(100, (points / Math.max(1, capacity)) * 100)}%` }} />
                      </span>
                    )}
                    {over && <span>over capacity</span>}
                  </div>
                  {!detail ? (
                    <Skeleton active title={false} paragraph={{ rows: 2 }} />
                  ) : (
                    <ul className="nx-pl-list" data-drop-list={sprint.id}>
                      {items.length === 0 && drag.drag?.over.lane !== sprint.id ? (
                        <li className="nx-pl-empty">Drag work here from the backlog</li>
                      ) : (
                        drag.renderLane(
                          sprint.id,
                          items,
                          (item) => item.id,
                          (item) => (
                            <li key={item.id}>
                              <PlanItem
                                item={item}
                                epicName={item.epic_id ? epicName.get(item.epic_id) : undefined}
                                drag={drag.cardProps(item.id, sprint.id)}
                                onOpen={() => navigate(`/tasks/${item.id}`)}
                              />
                            </li>
                          ),
                          (height) => <DropGap key="gap" height={Math.min(height, 44)} label="joins this sprint" />,
                        )
                      )}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>

          <Card
            className={`nx-pl-dropzone ${drag.laneProps(BACKLOG).className}`}
            data-drop-lane={BACKLOG}
            data-testid="backlog"
            title={
              <Space size={8}>
                <span>Backlog</span>
                <Tag>{backlog.data?.total ?? 0} items</Tag>
                <Points value={backlog.data?.total_points ?? 0} />
              </Space>
            }
          >
            <Input.Search
              allowClear
              aria-label="Search the backlog"
              placeholder="Search the backlog"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              style={{ marginBottom: 10 }}
            />
            {canManage && (
              <p className="nu-muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
                Drag to rank, or into a sprint to plan it. Space picks a focused row up; the arrows move it.
              </p>
            )}
            {backlog.isLoading ? (
              <Skeleton active title={false} paragraph={{ rows: 6 }} />
            ) : (
              <ul className="nx-pl-list" data-drop-list={BACKLOG} data-drag-scroll style={{ maxHeight: screens.lg ? "calc(100vh - 330px)" : undefined, overflow: "auto" }}>
                {listOf(BACKLOG).length === 0 && drag.drag?.over.lane !== BACKLOG ? (
                  <li className="nx-pl-empty">The backlog is empty — everything open is planned.</li>
                ) : (
                  drag.renderLane(
                    BACKLOG,
                    listOf(BACKLOG),
                    (item) => item.id,
                    (item) => (
                      <li key={item.id}>
                        <PlanItem
                          item={item}
                          epicName={item.epic_id ? epicName.get(item.epic_id) : undefined}
                          drag={drag.cardProps(item.id, BACKLOG)}
                          onOpen={() => navigate(`/tasks/${item.id}`)}
                        />
                      </li>
                    ),
                    (height) => <DropGap key="gap" height={Math.min(height, 44)} label="back to the backlog" />,
                  )
                )}
              </ul>
            )}
          </Card>
          {drag.overlay}
        </div>
      ) : tab === "board" ? (
        active && byId.get(active.id) ? (
          <SprintBoard sprint={byId.get(active.id)!} onOpen={(id) => navigate(`/tasks/${id}`)} onChanged={refresh} />
        ) : (
          <Card>
            <EmptyState
              title="No sprint is running"
              hint="Start a planned sprint to work it on a board."
              action={<Button onClick={() => set({ tab: null })}>Go to planning</Button>}
            />
          </Card>
        )
      ) : (
        <SprintReports project={project} sprints={all} chosen={params.get("sprint")} onChoose={(id) => set({ sprint: id })} />
      )}

      <SprintFormModal
        open={editing !== null}
        mode={editing?.mode}
        sprint={editing?.sprint}
        saving={save.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(values) => editing && save.mutate({ mode: editing.mode, sprint: editing.sprint, values })}
      />
      <CompleteSprintModal
        open={completing !== null}
        sprint={completing}
        unfinished={completing ? (byId.get(completing.id)?.tasks ?? []).filter((item) => !["DONE", "CANCELLED"].includes(item.status)).length : 0}
        hasNext={hasNext}
        saving={complete.isPending}
        onClose={() => setCompleting(null)}
        onSubmit={(carry) => completing && complete.mutate({ sprint: completing, carry })}
      />
    </>
  );
}

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

/** Burndown, velocity and the report of one sprint. */
export function SprintReports({
  project,
  sprints,
  chosen,
  onChoose,
}: {
  project: string;
  sprints: Sprint[];
  chosen: string | null;
  onChoose: (id: string) => void;
}) {
  const reportable = sprints.filter((item) => item.state !== "PLANNED");
  const fallback =
    reportable.find((item) => item.state === "ACTIVE") ??
    [...reportable].filter((item) => item.state === "COMPLETED").sort((a, b) => (b.end_date ?? "").localeCompare(a.end_date ?? ""))[0];
  const id = chosen && reportable.some((item) => item.id === chosen) ? chosen : fallback?.id ?? "";
  const detail = useQuery({
    queryKey: queryKeys.sprint(id),
    queryFn: ({ signal }) => planningApi.sprint(id, signal),
    enabled: Boolean(id),
  });
  const velocity = useQuery({
    queryKey: queryKeys.velocity(project),
    queryFn: ({ signal }) => planningApi.velocity({ project_id: project || undefined }, signal),
  });
  const sprint = detail.data;
  const report = sprint?.report;

  if (!id) {
    return (
      <Card>
        <EmptyState title="No sprint has started yet" hint="Reports appear once a sprint is running." />
      </Card>
    );
  }
  return (
    <>
      <div className="nx-pl-toolbar">
        <Select
          aria-label="Sprint"
          data-testid="report-sprint"
          style={{ minWidth: 240 }}
          value={id}
          onChange={onChoose}
          options={reportable.map((item) => ({ value: item.id, label: `${item.name}${item.state === "ACTIVE" ? " (running)" : ""}` }))}
        />
        {sprint && (
          <span className="nx-pl-legend">
            {sprint.start_date && sprint.end_date ? `${shortDate(sprint.start_date)} – ${shortDate(sprint.end_date)}` : ""}
          </span>
        )}
      </div>
      {sprint && (
        <div className="nx-pl-kpis">
          <div className="nx-pl-kpi">
            <span>Committed</span>
            <strong>
              {sprint.committed_points ?? sprint.total_points}
              <em>pts</em>
            </strong>
          </div>
          <div className="nx-pl-kpi">
            <span>Completed</span>
            <strong>
              {sprint.completed_points ?? sprint.done_points}
              <em>pts</em>
            </strong>
          </div>
          <div className="nx-pl-kpi">
            <span>Tasks done</span>
            <strong>
              {sprint.done_tasks}
              <em>of {sprint.total_tasks}</em>
            </strong>
          </div>
          <div className="nx-pl-kpi">
            <span>Average velocity</span>
            <strong>
              {velocity.data?.average ?? "—"}
              <em>pts</em>
            </strong>
          </div>
        </div>
      )}
      <div className="nx-pl-charts">
        <Card title="Burndown" size="small">
          {sprint ? <BurndownChart burndown={sprint.burndown} /> : <Skeleton active />}
        </Card>
        <Card title="Velocity" size="small">
          {velocity.data ? <VelocityChart velocity={velocity.data} /> : <Skeleton active />}
        </Card>
      </div>
      {report && (
        <Card title="Sprint report" size="small" className="nx-pl-report nu-block" style={{ marginTop: 14 }} data-testid="sprint-report">
          <dl>
            <dt>Completed</dt>
            <dd>{report.completed.length ? report.completed.join(", ") : "Nothing"}</dd>
            <dt>Carried over</dt>
            <dd>
              {report.carried_over.length ? report.carried_over.join(", ") : "Nothing"}
              {report.carried_over.length > 0 && ` → ${report.carried_to === "backlog" ? "backlog" : typeof report.carried_to === "object" ? report.carried_to.name : "next sprint"}`}
            </dd>
            <dt>Added after start</dt>
            <dd>{report.added_after_start.length ? report.added_after_start.join(", ") : "Nothing — the scope held"}</dd>
            <dt>Points</dt>
            <dd>
              {report.completed_points} of {report.committed_points} committed
            </dd>
          </dl>
        </Card>
      )}
    </>
  );
}
