/**
 * Projects as a portfolio table (§7, §48).
 *
 * This page was a Gantt: one bar per project from start to due, coloured by
 * health, with the budget burn beneath it. The shape was true — a project does
 * have a shape in time — but a reader could not get a *number* out of it. Two
 * bars overlapping in March is a fact about capacity; which of the two is
 * three weeks late and eleven points over its money is the fact somebody acts
 * on, and no amount of hovering a bar answers it for eight projects at once.
 *
 * So it is a table, and the columns are chosen to make the comparison the
 * timeline was reaching for readable down a column instead of across a row:
 * delivered, schedule used, budget used, side by side.
 *
 * **The standing is derived, never stored.** "Behind" is not a field — it is
 * what the gaps between those three numbers add up to, and the rule lives in
 * `entities/delivery.ts` with the delivery review that already uses it. Two
 * copies of "how far behind is too far" is two answers, and one of them would
 * be wrong the first time anybody changed it.
 *
 * Everything else — the metric strip, the filters, sorting, paging, export,
 * the create drawer — is the shared entity chrome, so this file holds the
 * project's *columns* and nothing about how a list works.
 */

import { Card, Progress, Skeleton, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { SorterResult } from "antd/es/table/interface";
import { useNavigate } from "react-router-dom";

import { EmptyState, NoResults } from "@/components/EmptyState";
import { StatusTag } from "@/components/StatusTag";
import {
  NewRecordButton,
  RecordActions,
  useRecordEditing,
} from "@/components/records/useRecordEditing";
import { opensRecord, useBulk } from "@/components/records/useBulk";
import { usePageCommands } from "@/commands/CommandContext";
import { behindOn, projectStanding, type ProjectStanding } from "@/entities/delivery";
import { EntityError, EntityFilters, EntityHeader, MetricStrip } from "@/entities/EntityChrome";
import { useEntityView } from "@/entities/useEntityView";
import { absoluteTime } from "@/lib/time";

const { Text } = Typography;

/**
 * `completed_at` and `currency` are asked for although no column shows them:
 * the standing rule needs to know a project is closed — "40% delivered on 90%
 * of the budget" is a finding on a live project and history on a finished one
 * — and money without its currency is a number, not an amount.
 */
const COLUMNS = [
  "code", "name", "status", "phase", "health", "priority",
  "start_date", "due_date", "completed_at", "budget", "spent", "currency", "progress",
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
  completed_at?: string | null;
  budget?: number;
  spent?: number;
  currency?: string;
  progress?: number;
}

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };

/**
 * What the derived standing is called, and how loudly.
 *
 * "Behind" carries *what* it is behind on, because a column in which every row
 * says the same word carries no information — and on this portfolio nearly
 * every project is over its money while several are ahead of their schedule.
 * Behind on money is a conversation with finance; behind on schedule is one
 * with delivery.
 */
/** `preset`, not `colour`: AntD preset names — see `EdgeTag` for why a field
 * called colour on a `Tag` is a fill with white text on it (§55). */
const STANDING: Record<ProjectStanding["standing"], { label: string; preset?: string }> = {
  behind: { label: "Behind", preset: "error" },
  ahead: { label: "Ahead", preset: "success" },
  even: { label: "On line" },
  done: { label: "Delivered", preset: "blue" },
};

const BEHIND_ON: Record<"schedule" | "money" | "both", string> = {
  schedule: "Behind · time",
  money: "Behind · money",
  both: "Behind · both",
};

export default function ProjectsPortfolioPage() {
  const navigate = useNavigate();
  const view = useEntityView("project", {
    columns: COLUMNS,
    defaultSort: "due_date",
    defaultOrder: "asc",
  });
  const rows = (view.rows.data?.items ?? []) as ProjectRow[];

  const records = useRecordEditing(view.resource, {
    onCreated: (id) => navigate(`/projects/${id}`),
  });
  // The list's own request is what "everything matching this filter" means,
  // sent unchanged — a hand-built copy of the filters would be a second
  // question, and rows nobody saw would change the first time the two differed.
  const bulk = useBulk(view.resource, {
    request: view.request,
    total: view.rows.data?.total ?? 0,
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

  /** The gaps, computed once per row and read by three columns. */
  const standingFor = (row: ProjectRow) =>
    projectStanding({
      startDate: row.start_date ?? null,
      dueDate: row.due_date ?? null,
      completedAt: row.completed_at ?? null,
      budget: row.budget ?? null,
      spent: row.spent ?? null,
      progress: row.progress ?? null,
    });

  /** An amount with its symbol — used by the budget tooltip. */
  const money = (value: number | undefined, currency: string | undefined) =>
    `${SYMBOL[currency ?? "EUR"] ?? ""}${Math.round(Number(value ?? 0)).toLocaleString()}`;

  const columns: ColumnsType<ProjectRow> = [
    {
      title: "Code",
      dataIndex: "code",
      width: 96,
      fixed: "left",
      sorter: true,
      render: (value: string) => <Text className="nu-mono">{value}</Text>,
    },
    {
      title: "Project",
      dataIndex: "name",
      ellipsis: true,
      sorter: true,
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: "Health",
      dataIndex: "health",
      width: 116,
      sorter: true,
      render: (value: string) => (
        <StatusTag status={value} bordered={false} />
      ),
    },
    {
      title: "Phase",
      dataIndex: "phase",
      width: 112,
      sorter: true,
      render: (value: string) => (
        <StatusTag status={value} bordered={false} />
      ),
    },
    {
      // Delivered, and the schedule beside it, because the pair is the point:
      // 40% delivered is neither good nor bad until you know how much of the
      // calendar has gone.
      title: "Delivered",
      dataIndex: "progress",
      width: 124,
      sorter: true,
      render: (_value: number, row) => {
        const standing = standingFor(row);
        return (
          <Tooltip title={standing.summary}>
            <div className="nu-meter">
              <Progress
                percent={standing.progress}
                size="small"
                showInfo={false}
                aria-label={`${row.name ?? "This project"}: ${standing.progress}% delivered`}
              />
              <Text className="nu-meter-value">{standing.progress}%</Text>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: "Schedule",
      key: "schedule",
      width: 96,
      align: "right",
      render: (_value: unknown, row) => {
        const { elapsed, scheduleGap } = standingFor(row);
        if (elapsed === null) return <Text type="secondary">No dates</Text>;
        return (
          <Tooltip title={`${elapsed}% of the schedule has been used`}>
            <Text style={gapStyle(scheduleGap)}>{elapsed}%</Text>
          </Tooltip>
        );
      },
    },
    {
      title: "Budget used",
      key: "burn",
      width: 126,
      align: "right",
      sorter: true,
      render: (_value: unknown, row) => {
        const { burn, budgetGap } = standingFor(row);
        if (burn === null) return <Text type="secondary">No budget</Text>;
        return (
          <Tooltip title={`${money(row.spent, row.currency)} of ${money(row.budget, row.currency)}`}>
            <Text style={gapStyle(budgetGap)}>{Math.round(burn)}%</Text>
          </Tooltip>
        );
      },
    },
    {
      // The finding, in a word. Derived from the three columns to its left, so
      // a reader can always see why it says what it says.
      title: "Standing",
      key: "standing",
      width: 128,
      render: (_value: unknown, row) => {
        const standing = standingFor(row);
        const shown = STANDING[standing.standing];
        const reason = behindOn(standing);
        return (
          <Tooltip title={standing.summary}>
            <Tag color={shown.preset} bordered={false}>
              {reason ? BEHIND_ON[reason] : shown.label}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "Due",
      dataIndex: "due_date",
      width: 124,
      sorter: true,
      defaultSortOrder: "ascend",
      render: (value: string | null, row) => {
        const { daysLeft, standing } = standingFor(row);
        if (!value) return <Text type="secondary">—</Text>;
        const late = daysLeft !== null && daysLeft < 0 && standing !== "done";
        return (
          <Tooltip title={absoluteTime(value)}>
            {/* Two deliberate lines rather than one that wraps wherever the
                column happens to end. */}
            <span className="nu-due">
              <Text type={late ? "danger" : undefined}>
                {new Date(value).toLocaleDateString()}
              </Text>
              {late && (
                <Text type="danger" className="nu-due-late">
                  {Math.abs(daysLeft)}d late
                </Text>
              )}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: "",
      key: "actions",
      width: 48,
      fixed: "right",
      render: (_value: unknown, row) => (
        <RecordActions
          records={records}
          id={row.id}
          label={row.code ?? row.name ?? "this project"}
        />
      ),
    },
  ];

  const onChange = (
    pagination: TablePaginationConfig,
    _filters: unknown,
    sorter: SorterResult<ProjectRow> | SorterResult<ProjectRow>[],
  ) => {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof single?.field === "string" ? single.field : view.sort;
    view.set({
      page: pagination.current === 1 ? null : (pagination.current ?? null),
      page_size: pagination.pageSize === 25 ? null : (pagination.pageSize ?? null),
      sort: single?.order ? field : null,
      order: single?.order === "ascend" ? "asc" : null,
    });
  };

  if (view.catalogue.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <EntityHeader
        view={view}
        subtitle="What each project has delivered, against the calendar it has used and the money it has spent."
        actions={<NewRecordButton records={records} resource={view.resource} />}
      />

      <MetricStrip view={view} accents={["accent", "danger", "info", "warning"]} />
      <EntityFilters view={view} only={["health", "phase", "status", "priority"]} />
      <EntityError view={view} />

      <Card size="small" className="nu-block" data-testid="project-table">
        {/* Above the table, not floating over it: a bar that covers the last
            row hides part of what the reader is deciding about (§43). */}
        {bulk.bar}
        <Table<ProjectRow>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          rowSelection={bulk.rowSelection}
          loading={view.rows.isLoading}
          onChange={onChange}
          scroll={{ x: 1160 }}
          onRow={(row) => ({
            // Not when the click was on a control — a tick box opens nothing.
            onClick: (event) => {
              if (opensRecord(event.target)) navigate(`/projects/${row.id}`);
            },
            style: { cursor: "pointer" },
          })}
          locale={{
            emptyText: view.rows.isLoading ? (
              " "
            ) : view.filterCount > 0 ? (
              <NoResults filterCount={view.filterCount} onClear={view.clearFilters} />
            ) : (
              <EmptyState
                title="No projects yet"
                hint="A project is work with a budget and a date."
                action={<NewRecordButton records={records} resource={view.resource} />}
              />
            ),
          }}
          pagination={{
            current: view.rows.data?.page ?? view.page,
            pageSize: view.rows.data?.page_size ?? view.pageSize,
            total: view.rows.data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [25, 50, 100],
            showTotal: (count, range) => `${range[0]}–${range[1]} of ${count.toLocaleString()}`,
          }}
        />
      </Card>

      {records.drawer}
      {bulk.dialog}
    </>
  );
}

/**
 * Colour a gap only when it is worth reading.
 *
 * The threshold is the standing rule's own — a page that reddened a two-point
 * gap would teach its reader to ignore the colour, which is the one thing a
 * warning colour cannot survive.
 *
 * The theme's *ink* variables rather than its fills, because this is text and
 * text needs 4.5:1 (§64) — and read through a CSS variable rather than the
 * token module, so the colour follows the reader's appearance instead of being
 * fixed to whichever one this file happened to import.
 */
function gapStyle(gap: number | null): React.CSSProperties | undefined {
  if (gap === null || Math.abs(gap) <= 10) return undefined;
  return { color: gap > 0 ? "var(--nu-danger-ink)" : "var(--nu-success-ink)" };
}
