import { useQuery } from "@tanstack/react-query";
import { Card, Select, Skeleton } from "antd";

import { planningApi, type Sprint } from "@/api/planning";
import { EmptyState } from "@/components/EmptyState";
import { BurndownChart, VelocityChart } from "@/components/planning/SprintCharts";
import { shortDate } from "@/components/planning/gantt";
import { queryKeys } from "@/lib/queryKeys";

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
