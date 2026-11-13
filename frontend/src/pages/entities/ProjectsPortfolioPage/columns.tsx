import { Progress, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import { StatusTag, type StatusTone } from "@/components/StatusTag";
import { RecordActions, type RecordEditing } from "@/components/records/useRecordEditing";
import { behindOn, projectStanding, type ProjectStanding } from "@/entities/delivery";
import { absoluteTime } from "@/lib/time";

import type { ProjectRow } from "./types";

const { Text } = Typography;

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
const STANDING: Record<ProjectStanding["standing"], { label: string; tone: StatusTone }> = {
  behind: { label: "Behind", tone: "bad" },
  ahead: { label: "Ahead", tone: "ok" },
  even: { label: "On line", tone: "neutral" },
  done: { label: "Delivered", tone: "acc" },
};

const BEHIND_ON: Record<"schedule" | "money" | "both", string> = {
  schedule: "Behind · time",
  money: "Behind · money",
  both: "Behind · both",
};

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

/** The portfolio's columns: delivered, schedule used and budget used, side by side. */
export function projectColumns(records: RecordEditing): ColumnsType<ProjectRow> {
  return [
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
            <span>
              <StatusTag
                status={standing.standing}
                tone={shown.tone}
                label={reason ? BEHIND_ON[reason] : shown.label}
              />
            </span>
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
