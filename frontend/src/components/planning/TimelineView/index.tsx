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

import { Alert, App as AntApp, Grid, Skeleton } from "antd";
import { useNavigate } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { FailureAlert } from "@/components/FailureAlert";

import { Gantt } from "../Gantt";

import { ScheduleWarning } from "./ScheduleWarning";
import { TimelineLegend, TimelineToolbar } from "./TimelineToolbar";
import { useTimeline } from "./useTimeline";

import type { TimelineState } from "./state";

export { DEFAULT_TIMELINE, type TimelineState } from "./state";

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
  const screens = Grid.useBreakpoint();
  const compact = !screens.md;
  const { modal } = AntApp.useApp();
  const model = useTimeline(state, fixedProject);
  const { timeline, data, bars, schedule, link, unlink, warning, setWarning, range, term, setTerm } = model;

  const legend = <TimelineLegend critical={state.critical} />;

  return (
    <>
      <TimelineToolbar
        state={state}
        onChange={onChange}
        fixedProject={fixedProject}
        compact={compact}
        term={term}
        onTerm={setTerm}
        legend={legend}
      />

      {warning && (
        <ScheduleWarning
          warning={warning}
          canEdit={Boolean(data?.can_edit)}
          compact={compact}
          onShift={() =>
            schedule.mutate({ bar: { ...warning.bar, updated_at: null }, start: warning.start, end: warning.end, shift: true })
          }
          onDismiss={() => setWarning(null)}
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
