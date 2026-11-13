import { Alert, App, Button, Card, Skeleton } from "antd";

import { isoDay, type Week, type WeekRow } from "@/api/time";
import { usePageCommands } from "@/commands/CommandContext";
import { EntryModal } from "@/components/decisions/EntryModal";
import { EmptyState } from "@/components/EmptyState";
import { NxIcon } from "@/components/NxIcon";
import { errorText } from "@/lib/errors";

import { AddRow } from "./AddRow";
import { DayCards } from "./DayCards";
import { EntryRows } from "./EntryRows";
import { WeekGrid } from "./WeekGrid";
import { WeekHead } from "./WeekHead";
import { confirmSubmit } from "./confirmSubmit";
import { useDevice, type Go } from "./timeCopy";
import { useWeekView } from "./useWeekView";

/** One person's week: the grid (or day cards on a phone), its entries and the log dialog. */
export function WeekView({ params, go }: { params: URLSearchParams; go: Go }) {
  const { modal } = App.useApp();
  const device = useDevice();
  const view = useWeekView(params);
  const { week, mine, logging, setLogging, extraRows, remove } = view;
  const submitWeek = (data: NonNullable<typeof week.data>) => confirmSubmit(modal, data, (note) => view.submit.mutateAsync(note));

  usePageCommands("time:week", [
    { id: "time.log", label: "Log time", keywords: "entry manual hours", run: () => setLogging({ open: true }) },
    ...(week.data?.can_submit
      ? [{ id: "time.submit", label: "Submit this week for approval", keywords: "timesheet", run: () => submitWeek(week.data) }]
      : []),
  ]);

  if (week.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (week.isError || !week.data) {
    return <Alert type="error" showIcon message={errorText(week.error, { fallback: "The week could not be read." })} />;
  }
  const data = week.data;
  const today = isoDay(new Date());
  const rows = [...data.rows, ...extraRows.filter((row) => !data.rows.some((r) => r.subject_id === row.subject_id))];

  return (
    <>
      <WeekHead data={data} mine={mine} go={go} onLog={() => setLogging({ open: true })} onSubmit={() => submitWeek(data)} />

      <WeekCard view={view} data={data} rows={rows} today={today} device={device} />

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

interface WeekCardProps {
  view: ReturnType<typeof useWeekView>;
  data: Week;
  rows: WeekRow[];
  today: string;
  device: ReturnType<typeof useDevice>;
}

function WeekCard({ view, data, rows, today, device }: WeekCardProps) {
  const { mine, setLogging, setExtraRows, adding, setAdding, cell } = view;
  return (
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
        <WeekGrid data={data} rows={rows} today={today} onCell={(body) => cell.mutate(body)} />
      )}
      {data.can_edit && (adding ? (
        <AddRow data={data} onAdd={(row) => setExtraRows((current) => [...current, row])} onClose={() => setAdding(false)} />
      ) : rows.length > 0 && device !== "phone" ? (
        <Button type="text" icon={<NxIcon name="plus" />} onClick={() => setAdding(true)} style={{ marginTop: 6 }}>
          Add a row
        </Button>
      ) : null)}
    </Card>
  );
}
