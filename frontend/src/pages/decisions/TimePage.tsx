import "@/styles/decisions.css";

import {
  Alert, App, Button, Card, DatePicker, Dropdown, Input, Pagination, Segmented, Select, Skeleton,
  Space, Tooltip, Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  decimalHours, hours, isoDay, mondayOf, parseDuration, timeApi,
  type ReportGroup, type SheetStatus, type TimeEntry, type Week, type WeekRow,
} from "@/api/time";
import { useAuth } from "@/auth/AuthProvider";
import { usePageCommands } from "@/commands/CommandContext";
import { EntryModal } from "@/components/decisions/EntryModal";
import { SubjectPicker, parseSubjectKey } from "@/components/decisions/SubjectPicker";
import { TdIcon } from "@/components/decisions/TdIcon";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { PersonAvatar } from "@/components/PersonAvatar";
import { errorText, errorToast } from "@/lib/errors";
import { EmptyState } from "@/components/EmptyState";
import { queryKeys } from "@/lib/queryKeys";

const { Text } = Typography;

type Tab = "week" | "entries" | "team" | "reports";

export const SHEET_TONE: Record<SheetStatus, string> = {
  DRAFT: "nx-td-pilltag",
  SUBMITTED: "nx-td-pilltag nx-td-pilltag--acc",
  APPROVED: "nx-td-pilltag nx-td-pilltag--ok",
  REJECTED: "nx-td-pilltag nx-td-pilltag--bad",
};
const SHEET_LABEL: Record<SheetStatus, string> = {
  DRAFT: "Draft", SUBMITTED: "Waiting for approval", APPROVED: "Approved", REJECTED: "Rejected",
};

function weekLabel(start: string): string {
  const from = dayjs(start);
  const to = from.add(6, "day");
  return from.month() === to.month()
    ? `${from.format("D")} – ${to.format("D MMM YYYY")}`
    : `${from.format("D MMM")} – ${to.format("D MMM YYYY")}`;
}

function useDevice(): "pc" | "tablet" | "phone" {
  const [device, setDevice] = useState<"pc" | "tablet" | "phone">(() => detect());
  useEffect(() => {
    const onResize = () => setDevice(detect());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return device;
}

function detect(): "pc" | "tablet" | "phone" {
  if (typeof window === "undefined") return "pc";
  if (window.innerWidth < 768) return "phone";
  return window.innerWidth < 1200 ? "tablet" : "pc";
}

/**
 * Time & timesheets: the week grid, every entry, the team's weeks and reports.
 *
 * The tab and the week are places (pushed onto history, so back walks them);
 * the report's range and grouping are filters (replaced).
 */
export default function TimePage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const canApprove = auth.can("time.approve");
  const raw = params.get("tab") as Tab | null;
  const tab: Tab = raw && ["week", "entries", "team", "reports"].includes(raw)
    ? (raw === "team" && !canApprove ? "week" : raw)
    : "week";

  const go = (next: Record<string, string | null>, replace = false) => {
    const copy = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") copy.delete(key);
      else copy.set(key, value);
    }
    setParams(copy, { replace });
  };

  return (
    <div className="nx-td" data-testid="time-page">
      <PageHeader
        title={<>Time &amp; <em>timesheets</em></>}
        subtitle="Timers, the week you submit, and where the hours went."
      />
      <div className="nx-td-chips" role="tablist" aria-label="Time views">
        {([
          ["week", "My week", "calendar"],
          ["entries", "Entries", "logs"],
          ...(canApprove ? [["team", "Team", "team"]] : []),
          ["reports", "Reports", "bars"],
        ] as [Tab, string, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`nx-td-chip${tab === key ? " is-on" : ""}`}
            onClick={() => go({ tab: key === "week" ? null : key, user: key === "week" ? params.get("user") : null })}
            data-testid={`time-tab-${key}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "week" && <WeekView params={params} go={go} />}
      {tab === "entries" && <EntriesView />}
      {tab === "team" && <TeamView params={params} go={go} />}
      {tab === "reports" && <ReportsView params={params} go={go} />}
    </div>
  );
}

type Go = (next: Record<string, string | null>, replace?: boolean) => void;

// ── Week ──────────────────────────────────────────────────────────────

function WeekView({ params, go }: { params: URLSearchParams; go: Go }) {
  const auth = useAuth();
  const { message, modal } = App.useApp();
  const client = useQueryClient();
  const device = useDevice();
  const weekParam = params.get("week") ?? mondayOf();
  const userParam = params.get("user") ?? "";
  const mine = !userParam || userParam === auth.profile?.user.id;
  const [logging, setLogging] = useState<{ open: boolean; entry?: TimeEntry | null; day?: string }>({ open: false });
  const [extraRows, setExtraRows] = useState<WeekRow[]>([]);
  const [adding, setAdding] = useState(false);

  const week = useQuery({
    queryKey: queryKeys.time("week", weekParam, mine ? "" : userParam),
    queryFn: ({ signal }) => timeApi.week({ week: weekParam, user_id: mine ? undefined : userParam }, signal),
  });

  useEffect(() => setExtraRows([]), [weekParam, userParam]);

  const cell = useMutation({
    mutationFn: timeApi.cell,
    onSuccess: (next) => {
      client.setQueryData(queryKeys.time("week", weekParam, ""), next);
      void client.invalidateQueries({ queryKey: queryKeys.time("timer") });
    },
    onError: (error) => {
      message.error(errorText(error, { action: "change this cell" }));
      void week.refetch();
    },
  });

  const submit = useMutation({
    mutationFn: (note: string) => timeApi.submit({ week: weekParam, note }),
    onSuccess: (next) => {
      client.setQueryData(queryKeys.time("week", weekParam, ""), next);
      void client.invalidateQueries({ queryKey: queryKeys.notifications() });
      message.success("Week submitted for approval");
    },
    onError: errorToast(message, { action: "submit this week" }),
  });

  const remove = useMutation({
    mutationFn: timeApi.remove,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.time() });
      message.success("Entry removed");
    },
    onError: errorToast(message, { action: "remove this entry" }),
  });

  const confirmSubmit = (data: Week) => {
    let note = "";
    modal.confirm({
      title: `Submit ${weekLabel(data.week_start)}?`,
      icon: null,
      content: (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text>
            {hours(data.total_minutes)} in total, {hours(data.billable_minutes)} billable. The week locks until it is
            approved or sent back.
          </Text>
          <Input.TextArea rows={2} placeholder="A note for your approver (optional)" onChange={(e) => { note = e.target.value; }} />
        </Space>
      ),
      okText: "Submit week",
      onOk: () => submit.mutateAsync(note),
    });
  };

  usePageCommands("time:week", [
    { id: "time.log", label: "Log time", keywords: "entry manual hours", run: () => setLogging({ open: true }) },
    ...(week.data?.can_submit
      ? [{ id: "time.submit", label: "Submit this week for approval", keywords: "timesheet", run: () => confirmSubmit(week.data) }]
      : []),
  ]);

  if (week.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (week.isError || !week.data) {
    return <Alert type="error" showIcon message={errorText(week.error, { fallback: "The week could not be read." })} />;
  }
  const data = week.data;
  const today = isoDay(new Date());
  const rows = [...data.rows, ...extraRows.filter((row) => !data.rows.some((r) => r.subject_id === row.subject_id))];
  const daysLogged = Object.values(data.day_totals).filter(Boolean).length;
  const status = data.timesheet.status;

  return (
    <>
      <div className="nx-td-weekhead">
        <Button aria-label="Previous week" icon={<NxIcon name="chevronLeft" />} onClick={() => go({ week: data.previous_week })} />
        <Button aria-label="Next week" icon={<NxIcon name="chevronRight" />} onClick={() => go({ week: data.next_week })} />
        <h2 data-testid="week-label">{weekLabel(data.week_start)}</h2>
        {data.week_start !== mondayOf() && <Button onClick={() => go({ week: null })}>This week</Button>}
        {!mine && <span className="nx-td-pilltag nx-td-pilltag--plain">{data.user.name}</span>}
        <span className={SHEET_TONE[status]} data-testid="week-status">{SHEET_LABEL[status]}</span>
        <span style={{ flex: 1 }} />
        {mine && (
          <Space wrap>
            <Button icon={<NxIcon name="plus" />} disabled={!data.can_edit} onClick={() => setLogging({ open: true })}>
              Log time
            </Button>
            <Button
              type="primary"
              icon={<TdIcon name="stamp" />}
              disabled={!data.can_submit}
              onClick={() => confirmSubmit(data)}
              data-testid="week-submit"
            >
              {status === "REJECTED" ? "Resubmit week" : "Submit week"}
            </Button>
          </Space>
        )}
      </div>

      <div className="nx-td-kpis">
        <div className="nx-td-kpi"><small>Total</small><strong data-testid="week-total">{hours(data.total_minutes)}</strong><span>this week</span></div>
        <div className="nx-td-kpi"><small>Billable</small><strong>{hours(data.billable_minutes)}</strong>
          <span>{data.total_minutes ? Math.round((data.billable_minutes * 100) / data.total_minutes) : 0}% of the week</span></div>
        <div className="nx-td-kpi"><small>Days logged</small><strong>{daysLogged}</strong><span>of 5 working days</span></div>
        <div className="nx-td-kpi"><small>Work items</small><strong>{data.rows.length}</strong><span>tasks, tickets, projects</span></div>
      </div>

      {status === "SUBMITTED" && (
        <div className="nx-td-lock" data-testid="week-locked">
          <TdIcon name="hourglass" /> Submitted {data.timesheet.submitted_at ? dayjs(data.timesheet.submitted_at).format("ddd D MMM, HH:mm") : ""} — locked until it is approved or sent back.
        </div>
      )}
      {status === "APPROVED" && (
        <div className="nx-td-lock nx-td-lock--ok" data-testid="week-locked">
          <NxIcon name="check" /> Approved — this week is closed.
        </div>
      )}
      {status === "REJECTED" && (
        <div className="nx-td-lock nx-td-lock--bad">
          <TdIcon name="x" /> Sent back{data.timesheet.decision_comment ? `: “${data.timesheet.decision_comment}”` : ""}. Fix it and resubmit.
        </div>
      )}

      <Card size="small">
        {rows.length === 0 && !adding ? (
          <EmptyState
            compact
            title={mine ? "Nothing logged this week. Start a timer, log time, or add a row." : "Nothing logged this week."}
            action={data.can_edit ? <Button onClick={() => setAdding(true)}>Add a row</Button> : undefined}
          />
        ) : device === "phone" ? (
          <DayCards data={data} rows={rows} onOpen={(entry) => setLogging({ open: true, entry })} />
        ) : (
          <div className="nx-td-gridwrap">
            <table className="nx-td-grid" data-testid="week-grid">
              <thead>
                <tr>
                  <th scope="col">Work item</th>
                  {data.days.map((day) => (
                    <th key={day} scope="col" className={day === today ? "is-today" : undefined}>
                      {dayjs(day).format("ddd D")}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.subject_type}:${row.subject_id}`}>
                    <td>
                      <div className="nx-td-subject">
                        {row.link ? <Link to={row.link}>{row.label}</Link> : <span>{row.label}</span>}
                        <small>{row.subject_type}</small>
                      </div>
                    </td>
                    {data.days.map((day, index) => (
                      <td key={day}>
                        <CellInput
                          minutes={row.cells[day] ?? 0}
                          fixed={row.fixed[day] ?? 0}
                          disabled={!data.can_edit}
                          weekend={index >= 5}
                          label={`${row.label} on ${dayjs(day).format("dddd D MMMM")}`}
                          onCommit={(minutes) =>
                            cell.mutate({ subject_type: row.subject_type, subject_id: row.subject_id, date: day, minutes })
                          }
                        />
                      </td>
                    ))}
                    <td className="nx-td-total">{hours(row.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Day total</td>
                  {data.days.map((day) => (
                    <td key={day}>{data.day_totals[day] ? hours(data.day_totals[day]) : "—"}</td>
                  ))}
                  <td data-testid="week-grid-total">{hours(data.total_minutes)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {data.can_edit && (adding ? (
          <div className="nx-td-bar" style={{ marginTop: 10 }}>
            <div className="nx-td-grow">
              <SubjectPicker
                autoFocus
                onChange={(value, subject) => {
                  const chosen = parseSubjectKey(value);
                  if (chosen) {
                    setExtraRows((current) => [...current, {
                      ...chosen, label: subject?.label ?? "", link: null,
                      cells: Object.fromEntries(data.days.map((day) => [day, 0])),
                      fixed: Object.fromEntries(data.days.map((day) => [day, 0])), total: 0, billable_minutes: 0,
                    }]);
                  }
                  setAdding(false);
                }}
              />
            </div>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        ) : rows.length > 0 && device !== "phone" ? (
          <Button type="text" icon={<NxIcon name="plus" />} onClick={() => setAdding(true)} style={{ marginTop: 6 }}>
            Add a row
          </Button>
        ) : null)}
      </Card>

      <p className="nx-td-section">Entries this week</p>
      <EntryRows
        entries={data.entries}
        editable={data.can_edit}
        onEdit={(entry) => setLogging({ open: true, entry })}
        onRemove={(entry) => remove.mutate(entry.id)}
      />

      <EntryModal
        open={logging.open}
        entry={logging.entry}
        day={logging.day ?? (data.days.includes(today) ? today : data.week_start)}
        onClose={() => setLogging({ open: false })}
      />
    </>
  );
}

/** One cell of the grid: hours as typed, saved on blur or Enter. */
function CellInput({
  minutes, fixed, disabled, weekend, label, onCommit,
}: {
  minutes: number; fixed: number; disabled: boolean; weekend: boolean; label: string;
  onCommit: (minutes: number) => void;
}) {
  const [text, setText] = useState(decimalHours(minutes));
  useEffect(() => setText(decimalHours(minutes)), [minutes]);
  const commit = () => {
    const parsed = parseDuration(text);
    if (parsed === null) {
      setText(decimalHours(minutes));
      return;
    }
    if (parsed !== minutes) onCommit(parsed);
  };
  return (
    <Tooltip title={fixed ? `${hours(fixed)} from timers and typed entries` : ""}>
      <input
        className={`nx-td-cell${weekend ? " is-weekend" : ""}`}
        value={text}
        disabled={disabled}
        inputMode="decimal"
        aria-label={label}
        placeholder={disabled ? "" : "–"}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") setText(decimalHours(minutes));
        }}
      />
    </Tooltip>
  );
}

function DayCards({ data, rows, onOpen }: { data: Week; rows: WeekRow[]; onOpen: (entry: TimeEntry) => void }) {
  return (
    <div className="nx-td-days" data-testid="week-days">
      {data.days.map((day) => {
        const entries = data.entries.filter((entry) => entry.work_date === day);
        return (
          <div key={day} className="nx-td-day">
            <div className="nx-td-day-head">
              <span>{dayjs(day).format("dddd D MMM")}</span>
              <span className="nx-td-num">{data.day_totals[day] ? hours(data.day_totals[day]) : "—"}</span>
            </div>
            {entries.length === 0 && <span className="nx-td-faint">Nothing logged</span>}
            {entries.map((entry) => (
              <div key={entry.id} className="nx-td-day-row">
                <span>{entry.subject_label}</span>
                <Button type="text" disabled={!data.can_edit || entry.running} onClick={() => onOpen(entry)}>
                  {entry.running ? "running" : hours(entry.minutes)}
                </Button>
              </div>
            ))}
          </div>
        );
      })}
      <span className="nx-td-faint">{rows.length} work items this week</span>
    </div>
  );
}

function EntryRows({
  entries, editable, onEdit, onRemove, showPerson = false,
}: {
  entries: TimeEntry[];
  editable: boolean;
  onEdit: (entry: TimeEntry) => void;
  onRemove: (entry: TimeEntry) => void;
  showPerson?: boolean;
}) {
  if (entries.length === 0) return <div className="nx-td-empty">No entries.</div>;
  return (
    <div className="nx-td-list" data-testid="time-entries">
      {entries.map((entry) => (
        <div key={entry.id} className="nx-td-row nx-td-row--nocheck">
          <span className="nx-td-row-icon"><TdIcon name={entry.source === "TIMER" ? "clock" : "form"} /></span>
          <div className="nx-td-row-main">
            {entry.link ? <Link className="nx-td-row-title" to={entry.link}>{entry.subject_label}</Link>
              : <span className="nx-td-row-title">{entry.subject_label}</span>}
            <div className="nx-td-row-meta">
              <span>{dayjs(entry.work_date).format("ddd D MMM")}</span>
              {entry.started_at && entry.ended_at && (
                <span>{dayjs(entry.started_at).format("HH:mm")}–{dayjs(entry.ended_at).format("HH:mm")}</span>
              )}
              {showPerson && entry.user_name && <span>{entry.user_name}</span>}
              <span>{entry.source === "TIMER" ? "Timer" : entry.source === "GRID" ? "Week grid" : "Typed"}</span>
              {entry.note && <span>“{entry.note}”</span>}
            </div>
          </div>
          <div className="nx-td-row-side">
            {entry.billable ? <span className="nx-td-pilltag nx-td-pilltag--acc">Billable</span>
              : <span className="nx-td-pilltag">Non-billable</span>}
            <b className="nx-td-num" style={{ minWidth: 64, textAlign: "end" }}>{entry.running ? "running" : hours(entry.minutes)}</b>
            {editable && !entry.running && (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    { key: "edit", label: "Edit" },
                    { key: "remove", label: "Remove", danger: true },
                  ],
                  onClick: ({ key }) => (key === "edit" ? onEdit(entry) : onRemove(entry)),
                }}
              >
                <Button type="text" aria-label={`Actions for ${entry.subject_label}`} icon={<NxIcon name="more" />} />
              </Dropdown>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Entries ───────────────────────────────────────────────────────────

const RANGES: Record<string, () => [string, string]> = {
  week: () => [mondayOf(), isoDay(new Date())],
  last7: () => [isoDay(dayjs().subtract(6, "day").toDate()), isoDay(new Date())],
  month: () => [isoDay(dayjs().startOf("month").toDate()), isoDay(new Date())],
  last30: () => [isoDay(dayjs().subtract(29, "day").toDate()), isoDay(new Date())],
};

function EntriesView() {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [range, setRange] = useState("last30");
  const [billable, setBillable] = useState<string>("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [from, to] = RANGES[range]!();
  const list = useQuery({
    queryKey: queryKeys.time("entries", range, billable, page),
    queryFn: ({ signal }) => timeApi.entries({ from, to, billable, page, page_size: 25 }, signal),
  });
  const remove = useMutation({
    mutationFn: timeApi.remove,
    onSuccess: () => { void client.invalidateQueries({ queryKey: queryKeys.time() }); message.success("Entry removed"); },
    onError: errorToast(message, { action: "remove this entry" }),
  });
  return (
    <>
      <div className="nx-td-bar">
        <Segmented
          value={range}
          onChange={(value) => { setRange(String(value)); setPage(1); }}
          options={[
            { value: "week", label: "This week" }, { value: "last7", label: "7 days" },
            { value: "month", label: "This month" }, { value: "last30", label: "30 days" },
          ]}
        />
        <Select
          aria-label="Billable"
          value={billable}
          onChange={(value) => { setBillable(value); setPage(1); }}
          style={{ minWidth: 150 }}
          options={[{ value: "", label: "Billable: any" }, { value: "true", label: "Billable only" }, { value: "false", label: "Non-billable" }]}
        />
        <span style={{ flex: 1 }} />
        {list.data && <Text strong>{hours(list.data.total_minutes)} in {list.data.total} entries</Text>}
      </div>
      {list.isLoading ? <Skeleton active /> : list.isError ? (
        <Alert type="error" showIcon message={errorText(list.error)} />
      ) : (
        <EntryRows entries={list.data!.items} editable onEdit={setEditing} onRemove={(entry) => remove.mutate(entry.id)} />
      )}
      {list.data && list.data.total > 25 && (
        <Pagination current={page} pageSize={25} total={list.data.total} onChange={setPage} showSizeChanger={false} align="end" />
      )}
      <EntryModal open={Boolean(editing)} entry={editing} onClose={() => setEditing(null)} />
    </>
  );
}

// ── Team ──────────────────────────────────────────────────────────────

function TeamView({ params, go }: { params: URLSearchParams; go: Go }) {
  const weekParam = params.get("week") ?? isoDay(dayjs(mondayOf()).subtract(7, "day").toDate());
  const team = useQuery({
    queryKey: queryKeys.time("team", weekParam),
    queryFn: ({ signal }) => timeApi.team(weekParam, signal),
  });
  if (team.isLoading) return <Skeleton active />;
  if (team.isError || !team.data) return <Alert type="error" showIcon message={errorText(team.error)} />;
  const data = team.data;
  return (
    <>
      <div className="nx-td-weekhead">
        <Button aria-label="Previous week" icon={<NxIcon name="chevronLeft" />} onClick={() => go({ week: data.previous_week })} />
        <Button aria-label="Next week" icon={<NxIcon name="chevronRight" />} onClick={() => go({ week: data.next_week })} />
        <h2>{weekLabel(data.week_start)}</h2>
        <span style={{ flex: 1 }} />
        {(["SUBMITTED", "REJECTED", "DRAFT", "APPROVED"] as SheetStatus[]).map((key) => (
          <span key={key} className={SHEET_TONE[key]}>{SHEET_LABEL[key]} {data.counts[key] ?? 0}</span>
        ))}
      </div>
      {data.items.length === 0 ? <div className="nx-td-empty">Nobody logged time this week.</div> : (
        <div className="nx-td-list" data-testid="time-team">
          {data.items.map((row) => (
            <div key={row.user.id} className="nx-td-row nx-td-row--nocheck">
              <PersonAvatar name={row.user.name} src={row.user.avatar_url} size={38} />
              <div className="nx-td-row-main">
                <button type="button" className="nx-td-row-title" onClick={() => go({ tab: null, user: row.user.id, week: data.week_start })}>
                  {row.user.name}
                </button>
                <div className="nx-td-row-meta">
                  <span>{row.user.job_title ?? ""}</span>
                  <span>{hours(row.billable_minutes)} billable</span>
                </div>
              </div>
              <div className="nx-td-row-side">
                <span className={SHEET_TONE[row.status]}>{SHEET_LABEL[row.status]}</span>
                <b className="nx-td-num" style={{ minWidth: 64, textAlign: "end" }}>{hours(row.total_minutes)}</b>
                {row.status === "SUBMITTED" && row.approval_id && (
                  <Link to={`/approvals?open=${row.approval_id}`}><Button type="primary">Review</Button></Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Reports ───────────────────────────────────────────────────────────

const GROUPS: { value: ReportGroup; label: string }[] = [
  { value: "person", label: "Person" }, { value: "project", label: "Project" },
  { value: "customer", label: "Customer" }, { value: "subject", label: "Work item" }, { value: "day", label: "Day" },
];

function ReportsView({ params, go }: { params: URLSearchParams; go: Go }) {
  const { message } = App.useApp();
  const from = params.get("from") ?? isoDay(dayjs().subtract(29, "day").toDate());
  const to = params.get("to") ?? isoDay(new Date());
  const group = (params.get("by") as ReportGroup | null) ?? "project";
  const billable = (params.get("billable") ?? "") as "" | "true" | "false";
  const filter = { from, to, group_by: group, billable };
  const report = useQuery({
    queryKey: queryKeys.time("report", filter),
    queryFn: ({ signal }) => timeApi.report(filter, signal),
  });
  const [exporting, setExporting] = useState(false);
  const exportAs = async (format: "csv" | "xlsx") => {
    setExporting(true);
    try {
      await timeApi.exportFile({ ...filter, format });
    } catch (error) {
      message.error(errorText(error, { action: "export time" }));
    } finally {
      setExporting(false);
    }
  };
  const max = useMemo(() => Math.max(1, ...(report.data?.items ?? []).map((item) => item.minutes)), [report.data]);

  return (
    <>
      <div className="nx-td-bar">
        <DatePicker.RangePicker
          aria-label="Range"
          allowClear={false}
          value={[dayjs(from), dayjs(to)]}
          onChange={(value) => value && value[0] && value[1] && go({ from: value[0].format("YYYY-MM-DD"), to: value[1].format("YYYY-MM-DD") }, true)}
        />
        <Segmented value={group} onChange={(value) => go({ by: String(value) }, true)} options={GROUPS} />
        <Select
          aria-label="Billable"
          value={billable}
          onChange={(value) => go({ billable: value }, true)}
          style={{ minWidth: 150 }}
          options={[{ value: "", label: "Billable: any" }, { value: "true", label: "Billable only" }, { value: "false", label: "Non-billable" }]}
        />
        <span style={{ flex: 1 }} />
        <Dropdown
          menu={{
            items: [{ key: "csv", label: "CSV" }, { key: "xlsx", label: "Excel (XLSX)" }],
            onClick: ({ key }) => void exportAs(key as "csv" | "xlsx"),
          }}
        >
          <Button icon={<NxIcon name="export" />} loading={exporting} data-testid="time-export">Export</Button>
        </Dropdown>
      </div>
      {report.isLoading ? <Skeleton active /> : report.isError || !report.data ? (
        <Alert type="error" showIcon message={errorText(report.error)} />
      ) : (
        <>
          <div className="nx-td-kpis">
            <div className="nx-td-kpi"><small>Logged</small><strong>{hours(report.data.total_minutes)}</strong><span>{dayjs(from).format("D MMM")} – {dayjs(to).format("D MMM")}</span></div>
            <div className="nx-td-kpi"><small>Billable</small><strong>{hours(report.data.billable_minutes)}</strong>
              <span>{report.data.total_minutes ? Math.round((report.data.billable_minutes * 100) / report.data.total_minutes) : 0}% utilisation</span></div>
            <div className="nx-td-kpi"><small>{GROUPS.find((g) => g.value === group)?.label}s</small><strong>{report.data.items.length}</strong><span>with time</span></div>
            <div className="nx-td-kpi"><small>Scope</small><strong style={{ fontSize: 18 }}>{report.data.can_see_everyone ? "Everyone" : "Only you"}</strong><span>{report.data.can_see_everyone ? "you approve time" : "your own entries"}</span></div>
          </div>
          <Card size="small" title={`By ${GROUPS.find((g) => g.value === group)?.label.toLowerCase()}`}>
            {report.data.items.length === 0 ? <div className="nx-td-empty">No time in this range.</div> : (
              <div data-testid="time-report">
                {report.data.items.map((item) => (
                  <div key={`${item.key}-${item.label}`} className="nx-td-hbar">
                    <span className="nx-td-hbar-label" title={item.label}>{item.label}</span>
                    <span className="nx-td-hbar-track" aria-hidden>
                      <i style={{ width: `${(item.minutes * 100) / max}%` }} />
                      <b style={{ width: `${(item.billable_minutes * 100) / max}%` }} />
                    </span>
                    <span className="nx-td-hbar-value">{hours(item.minutes)} <Text type="secondary">· {hours(item.billable_minutes)} billable</Text></span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
