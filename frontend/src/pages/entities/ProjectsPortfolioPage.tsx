/**
 * Projects as a portfolio timeline (§7, §48).
 *
 * A project is a thing with a *shape in time* — it starts, it runs, it is due —
 * and a table of dates hides exactly that. Two projects whose bars overlap in
 * March is a fact about capacity that no amount of sorting a `start_date`
 * column reveals.
 *
 * So the list is a timeline: one row per project, a bar from start to due,
 * coloured by the health the delivery team reports, with the budget burn drawn
 * underneath it. Health and burn are the two numbers that disagree most often
 * — "on track" at 96% of budget is the finding — and putting them on one row
 * is the whole point of the page.
 *
 * The axis spans only what the *filtered* set covers, so filtering to one
 * quarter zooms into that quarter rather than leaving a flat line at the end
 * of two years.
 */

import { Card, Empty, Progress, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import {
  NewRecordButton,
  RecordActions,
  useRecordEditing,
} from "@/components/records/useRecordEditing";
import { usePageCommands } from "@/commands/CommandContext";
import { EntityError, EntityFilters, EntityHeader, MetricStrip } from "@/entities/EntityChrome";
import { useEntityView } from "@/entities/useEntityView";
import { absoluteTime } from "@/lib/time";
import { knownStatusColor, SEMANTIC } from "@/theme/tokens";

const { Text } = Typography;

const COLUMNS = [
  "code", "name", "status", "phase", "health", "priority",
  "start_date", "due_date", "budget", "spent", "progress",
];

interface ProjectRow {
  id: string;
  code?: string;
  name?: string;
  status?: string;
  phase?: string;
  health?: string;
  priority?: string;
  start_date?: string | null;
  due_date?: string | null;
  budget?: number;
  spent?: number;
  progress?: number;
}

const HEALTH_COLOUR: Record<string, string> = {
  ON_TRACK: SEMANTIC.success,
  AT_RISK: SEMANTIC.warning,
  OFF_TRACK: SEMANTIC.danger,
};

export default function ProjectsPortfolioPage() {
  const navigate = useNavigate();
  const view = useEntityView("project", {
    columns: COLUMNS,
    defaultSort: "start_date",
    defaultOrder: "asc",
    defaultPageSize: 50,
  });
  // Memoised because two `useMemo`s below depend on it, and a fresh array
  // identity every render would recompute the axis on every keystroke.
  const rows = useMemo(
    () => (view.rows.data?.items ?? []) as ProjectRow[],
    [view.rows.data],
  );

  /** The window the bars are drawn in: what the filtered set actually spans. */
  const span = useMemo(() => {
    const instants = rows
      .flatMap((row) => [row.start_date, row.due_date])
      .map((value) => (value ? new Date(value).valueOf() : Number.NaN))
      .filter((value) => !Number.isNaN(value));
    if (instants.length === 0) return null;
    const from = Math.min(...instants);
    const to = Math.max(...instants);
    // A single-day span would divide by zero; give it a week of room.
    return { from, to: to > from ? to : from + 7 * 86_400_000 };
  }, [rows]);

  /** Where a bar starts and how wide it is, as percentages of the window. */
  const place = (row: ProjectRow) => {
    if (!span || !row.start_date || !row.due_date) return null;
    const start = new Date(row.start_date).valueOf();
    const end = new Date(row.due_date).valueOf();
    const width = span.to - span.from;
    return {
      left: `${((start - span.from) / width) * 100}%`,
      width: `${Math.max(((end - start) / width) * 100, 0.8)}%`,
    };
  };

  const months = useMemo(() => {
    if (!span) return [];
    const marks: { label: string; left: string }[] = [];
    const cursor = new Date(span.from);
    cursor.setDate(1);
    while (cursor.valueOf() <= span.to) {
      marks.push({
        label: cursor.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        left: `${((cursor.valueOf() - span.from) / (span.to - span.from)) * 100}%`,
      });
      cursor.setMonth(cursor.getMonth() + (span.to - span.from > 500 * 86_400_000 ? 3 : 1));
    }
    return marks;
  }, [span]);

  const records = useRecordEditing(view.resource, {
    onCreated: (id) => navigate(`/projects/${id}`),
  });

  usePageCommands("entity:project", [
    {
      id: "project.new",
      label: "Create a project",
      keywords: "new add create",
      run: records.create,
    },
    {
      id: "project.at-risk",
      label: "Show the projects that are at risk",
      keywords: "health red amber",
      run: () => view.setFilter("health", "AT_RISK"),
    },
    {
      id: "project.overspent",
      label: "Ask which projects are over budget",
      keywords: "budget spend overrun",
      run: () => navigate("/explore?resource=project"),
    },
  ]);

  if (view.catalogue.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <EntityHeader
        view={view}
        subtitle="Every project on one axis, coloured by the health it reports and measured against its budget."
        actions={<NewRecordButton records={records} resource={view.resource} />}
      />

      <MetricStrip view={view} accents={["accent", "danger", "info", "warning"]} />
      <EntityFilters view={view} only={["health", "phase", "status", "priority"]} />
      <EntityError view={view} />

      <Card size="small" className="nu-block" data-testid="project-timeline">
        {view.rows.isLoading ? (
          <Skeleton active paragraph={{ rows: 10 }} />
        ) : rows.length === 0 ? (
          <Empty description="No projects match these filters" />
        ) : (
          <div className="nu-timeline">
            <div className="nu-timeline-axis" aria-hidden>
              {months.map((mark) => (
                <span key={mark.label} className="nu-timeline-tick" style={{ left: mark.left }}>
                  {mark.label}
                </span>
              ))}
            </div>

            {rows.map((project) => {
              const bar = place(project);
              const burn = project.budget ? (Number(project.spent) / Number(project.budget)) * 100 : 0;
              const health = project.health ?? "";
              return (
                <div
                  key={project.id}
                  className="nu-timeline-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") navigate(`/projects/${project.id}`);
                  }}
                >
                  <div className="nu-timeline-label">
                    <Text strong ellipsis>
                      {project.name}
                    </Text>
                    <Space size={4} wrap>
                      <Text type="secondary">{project.code}</Text>
                      <Tag color={knownStatusColor(project.phase ?? "")} bordered={false}>
                        {project.phase}
                      </Tag>
                    </Space>
                  </div>

                  <div className="nu-timeline-track">
                    {bar ? (
                      <Tooltip
                        title={
                          <>
                            {absoluteTime(project.start_date)} → {absoluteTime(project.due_date)}
                            <br />
                            {Math.round(Number(project.progress ?? 0))}% complete ·{" "}
                            {Math.round(burn)}% of budget spent
                          </>
                        }
                      >
                        <div
                          className="nu-timeline-bar"
                          style={{
                            ...bar,
                            background: HEALTH_COLOUR[health] ?? "var(--nu-border-strong)",
                          }}
                        >
                          {/* Progress inside the bar: how far along the work
                              is, against how far along the calendar is. */}
                          <span
                            className="nu-timeline-progress"
                            style={{ width: `${Number(project.progress ?? 0)}%` }}
                          />
                        </div>
                      </Tooltip>
                    ) : (
                      <Text type="secondary" className="nu-timeline-undated">
                        No dates
                      </Text>
                    )}
                  </div>

                  <div className="nu-timeline-burn">
                    <Tooltip
                      title={`€${Math.round(Number(project.spent ?? 0)).toLocaleString()} of €${Math.round(
                        Number(project.budget ?? 0),
                      ).toLocaleString()}`}
                    >
                      <Progress
                        percent={Math.min(Math.round(burn), 100)}
                        size="small"
                        // Over 90% of budget is worth seeing before it is 100.
                        status={burn > 90 ? "exception" : "normal"}
                        format={() => `${Math.round(burn)}%`}
                      />
                    </Tooltip>
                    <RecordActions
                      records={records}
                      id={project.id}
                      label={project.code ?? project.name ?? "this project"}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {records.drawer}
    </>
  );
}
