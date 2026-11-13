import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Grid } from "antd";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { planningApi, type Sprint, type SprintCard, type SprintDetail } from "@/api/planning";
import { useBoardDrag } from "@/components/kanban/useBoardDrag";
import { type SprintValues } from "@/components/planning/SprintModals";
import { useProjects } from "@/components/planning/useProjects";
import { useUrlState } from "@/hooks/useUrlState";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import "@/styles/planning.css";
import { queryKeys } from "@/lib/queryKeys";

import { BACKLOG, Tab } from "./constants";

/**
 * Sprint planning's state: the project and tab in the address, the sprints
 * and their details, the backlog, the drag that plans and ranks, and the
 * sprint writes (save, complete, remove).
 */
export function useSprintsPage() {
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

  return { navigate, queryClient, message, modal, screens, params, set, projects, term, setTerm, search, editing, setEditing, completing, setCompleting, tab, running, project, sprints, all, open, active, canManage, details, byId, backlog, epics, epicName, refresh, failed, listOf, lanes, cards, plan, drag, save, complete, remove, hasNext, loading };
}

export type SprintsPageModel = ReturnType<typeof useSprintsPage>;
