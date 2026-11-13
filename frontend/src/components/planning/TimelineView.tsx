/**
 * The timeline with its controls and its writes (§18) — used whole by
 * `/timeline` and, scoped to one project, by a project's delivery page.
 *
 * A move is optimistic and then reconciled (§73): the bar stays where it was
 * dropped while the write goes, and the server's answer — including which
 * dependencies the new dates break — replaces the guess. A broken dependency
 * is a warning, never a refusal: the banner names it and offers to shift
 * everything downstream, which is one more write with `shift_dependants`.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App as AntApp, Button, Grid, Input, Segmented, Select, Skeleton, Space, Switch, Tooltip } from "antd";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  planningApi,
  type Dependency,
  type Timeline,
  type TimelineBar,
  type TimelineGrouping,
  type Violation,
} from "@/api/planning";
import { EmptyState } from "@/components/EmptyState";
import { FailureAlert } from "@/components/FailureAlert";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

import { Gantt } from "./Gantt";
import { shortDate, windowFor, ZOOMS, type Zoom } from "./gantt";
import { projectOptions, useProjects } from "./useProjects";
import { queryKeys } from "@/lib/queryKeys";

export interface TimelineState {
  group: TimelineGrouping;
  zoom: Zoom;
  project: string;
  q: string;
  done: boolean;
  critical: boolean;
}

export const DEFAULT_TIMELINE: TimelineState = {
  group: "project",
  zoom: "week",
  project: "",
  q: "",
  done: true,
  critical: true,
};

interface Warning {
  bar: { id: string; reference: string; title: string };
  start: string;
  end: string;
  violations: Violation[];
}

export function TimelineView({
  state,
  onChange,
  fixedProject,
}: {
  state: TimelineState;
  onChange: (changes: Partial<TimelineState>) => void;
  /** Scope to one project and hide the project picker. */
  fixedProject?: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const screens = Grid.useBreakpoint();
  const compact = !screens.md;
  const projects = useProjects();
  const [term, setTerm] = useState(state.q);
  const search = useDebouncedValue(term, 300);
  const [warning, setWarning] = useState<Warning | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const range = windowFor(state.zoom, today);
  const project = fixedProject ?? state.project;
  const key = queryKeys.timeline(state.group, range.from, range.to, project, search, state.done);

  const timeline = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      planningApi.timeline(
        {
          group: state.group,
          from: range.from,
          to: range.to,
          project_id: project || undefined,
          q: search || undefined,
          include_done: state.done,
        },
        signal,
      ),
    placeholderData: (previous) => previous,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.timeline() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.taskPlanning() });
  };
  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : "That change could not be saved.");

  const schedule = useMutation({
    mutationFn: ({ bar, start, end, shift }: { bar: Pick<TimelineBar, "id" | "reference" | "title" | "updated_at">; start: string; end: string; shift?: boolean; undo?: { start: string; end: string } }) =>
      planningApi.schedule(bar.id, { start_date: start, due_date: end, shift_dependants: shift }),
    onMutate: async ({ bar, start, end }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Timeline>(key);
      queryClient.setQueryData<Timeline>(key, (current) =>
        current
          ? {
              ...current,
              groups: current.groups.map((group) => ({
                ...group,
                items: group.items.map((item) => (item.id === bar.id ? { ...item, start, end, scheduled: true } : item)),
              })),
            }
          : current,
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      failed(error);
    },
    onSuccess: (result, { bar, start, end, shift, undo }) => {
      if (result.violations.length > 0) {
        setWarning({ bar, start, end, violations: result.violations });
        return;
      }
      setWarning(null);
      if (shift) {
        message.success(
          result.shifted.length
            ? `${result.shifted.length} dependent task${result.shifted.length === 1 ? "" : "s"} moved along`
            : "Nothing downstream needed to move",
        );
        return;
      }
      message.success({
        content: (
          <span>
            {bar.reference} now runs {shortDate(start)} – {shortDate(end)}{" "}
            {undo && (
              <Button
                type="text"
                onClick={() => schedule.mutate({ bar, start: undo.start, end: undo.end })}
              >
                Undo
              </Button>
            )}
          </span>
        ),
        duration: 5,
      });
    },
    onSettled: refresh,
  });

  const link = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      planningApi.link({ predecessor_id: from, successor_id: to }),
    onSuccess: (created) => {
      const pred = bars.get(created.predecessor_id);
      const succ = bars.get(created.successor_id);
      if (created.violated && pred && succ) {
        setWarning({
          bar: pred,
          start: pred.start,
          end: pred.end,
          violations: [
            {
              dependency_id: created.id,
              side: "successor",
              predecessor: { id: pred.id, reference: pred.reference, title: pred.title, end: pred.end },
              successor: { id: succ.id, reference: succ.reference, title: succ.title, start: succ.start },
              overlap_days: 0,
            },
          ],
        });
      } else {
        message.success(`${succ?.reference ?? "That task"} now waits on ${pred?.reference ?? "the other"}`);
      }
    },
    onError: failed,
    onSettled: refresh,
  });

  const unlink = useMutation({
    mutationFn: (dependency: Dependency) => planningApi.unlink(dependency.id),
    onSuccess: () => message.success("Dependency removed"),
    onError: failed,
    onSettled: refresh,
  });

  const data = timeline.data;
  const bars = useMemo(() => {
    const map = new Map<string, TimelineBar>();
    for (const group of data?.groups ?? []) for (const bar of group.items) map.set(bar.id, bar);
    return map;
  }, [data]);

  const legend = (
    <span className="nx-pl-legend" aria-label="Legend">
      <span>
        <i /> Task
      </span>
      <span>
        <i className="is-milestone" /> Milestone
      </span>
      {state.critical && (
        <span>
          <i className="is-critical" /> Critical path
        </span>
      )}
      <span>
        <i className="is-broken" /> Broken dependency
      </span>
    </span>
  );

  return (
    <>
      <div className="nx-pl-toolbar" data-testid="timeline-toolbar">
        <Segmented
          aria-label="Group by"
          value={state.group}
          onChange={(value) => onChange({ group: value as TimelineGrouping })}
          options={[
            { value: "project", label: "Project" },
            { value: "epic", label: "Epic" },
            { value: "assignee", label: "Person" },
          ]}
        />
        <Segmented
          aria-label="Zoom"
          data-testid="timeline-zoom"
          value={state.zoom}
          onChange={(value) => onChange({ zoom: value })}
          options={(Object.keys(ZOOMS) as Zoom[]).map((zoom) => ({ value: zoom, label: ZOOMS[zoom].label }))}
        />
        {!fixedProject && (
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            aria-label="Project"
            placeholder="Every project"
            style={{ minWidth: compact ? 160 : 240 }}
            loading={projects.isLoading}
            value={state.project || undefined}
            onChange={(value: string | undefined) => onChange({ project: value ?? "" })}
            options={projectOptions(projects.data)}
            data-testid="timeline-project"
          />
        )}
        <Input.Search
          allowClear
          aria-label="Search the timeline"
          placeholder="Search work"
          style={{ width: compact ? 150 : 200 }}
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            onChange({ q: event.target.value });
          }}
        />
        <Space size={6}>
          <Switch size="small" checked={state.done} onChange={(done) => onChange({ done })} aria-label="Show finished work" />
          <span>Done</span>
        </Space>
        <Tooltip title="The chain of linked work with no slack: if any of it slips, the end date slips.">
          <Space size={6}>
            <Switch
              size="small"
              checked={state.critical}
              onChange={(critical) => onChange({ critical })}
              aria-label="Highlight the critical path"
              data-testid="timeline-critical"
            />
            <span>Critical path</span>
          </Space>
        </Tooltip>
        <span className="nx-pl-spacer" />
        {!compact && legend}
      </div>

      {warning && (
        <Alert
          className="nx-pl-warning"
          type="warning"
          showIcon
          data-testid="timeline-warning"
          message={`${warning.bar.reference} now overlaps ${warning.violations.length === 1 ? "a task that waits on it" : `${warning.violations.length} dependencies`}`}
          description={
            <ul>
              {warning.violations.map((item) => (
                <li key={item.dependency_id}>
                  {item.successor.reference} {item.successor.title} starts {shortDate(item.successor.start)}, before{" "}
                  {item.predecessor.reference} ends {shortDate(item.predecessor.end)}.
                </li>
              ))}
            </ul>
          }
          action={
            data?.can_edit ? (
              <Space direction={compact ? "vertical" : "horizontal"}>
                {warning.violations.some((item) => item.side === "successor") && (
                  <Button
                    type="primary"
                    data-testid="timeline-shift"
                    onClick={() =>
                      schedule.mutate({ bar: { ...warning.bar, updated_at: null }, start: warning.start, end: warning.end, shift: true })
                    }
                  >
                    Shift dependants
                  </Button>
                )}
                <Button onClick={() => setWarning(null)}>
                  Keep as is
                </Button>
              </Space>
            ) : undefined
          }
          closable
          onClose={() => setWarning(null)}
        />
      )}

      {timeline.isError ? (
        <FailureAlert error={timeline.error} onRetry={() => void timeline.refetch()} />
      ) : !data ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : data.groups.length === 0 ? (
        <div className="nx-glass nu-block" style={{ padding: 24, borderRadius: 22 }}>
          <EmptyState
            title="Nothing scheduled in this window"
            hint="Give a task a start and a due date, widen the zoom, or clear the search."
          />
        </div>
      ) : (
        <>
          {data.truncated && (
            <Alert
              className="nu-block"
              type="info"
              showIcon
              message={`Showing the first ${data.total} bars — narrow to a project to see all of its work.`}
            />
          )}
          <Gantt
            data={data}
            zoom={state.zoom}
            from={range.from}
            to={range.to}
            showCritical={state.critical}
            canEdit={data.can_edit}
            compact={compact}
            onOpen={(bar) => navigate(`/tasks/${bar.id}`)}
            onSchedule={(bar, start, end) =>
              schedule.mutate({ bar, start, end, undo: { start: bar.start, end: bar.end } })
            }
            onLink={(from, to) => link.mutate({ from, to })}
            onUnlink={(dependency) =>
              modal.confirm({
                title: "Remove this dependency?",
                content: `${bars.get(dependency.successor_id)?.reference ?? "The task"} will no longer wait on ${
                  bars.get(dependency.predecessor_id)?.reference ?? "the other"
                }.`,
                okText: "Remove",
                okButtonProps: { danger: true },
                onOk: () => unlink.mutateAsync(dependency),
              })
            }
          />
          {compact && <div style={{ marginTop: 10 }}>{legend}</div>}
          <p className="nu-muted" style={{ marginTop: 10, fontSize: 12 }}>
            {data.can_edit
              ? "Drag a bar to move it, drag its ends to change its dates, and drag the dot at its end onto another bar to make that one wait on it. Click an arrow to remove it. A focused bar moves with ← → (Shift for its end)."
              : "Read-only: changing dates needs the records.update permission."}
          </p>
        </>
      )}
    </>
  );
}
