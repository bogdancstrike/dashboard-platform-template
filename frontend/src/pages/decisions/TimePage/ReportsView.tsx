import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Card, DatePicker, Dropdown, Segmented, Select, Skeleton, Typography } from "antd";
import dayjs from "dayjs";

import { hours, isoDay, timeApi, type ReportGroup, type TimeReport } from "@/api/time";
import { NxIcon } from "@/components/NxIcon";
import { errorText } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

import type { Go } from "./timeCopy";

const { Text } = Typography;

const GROUPS: { value: ReportGroup; label: string }[] = [
  { value: "person", label: "Person" }, { value: "project", label: "Project" },
  { value: "customer", label: "Customer" }, { value: "subject", label: "Work item" }, { value: "day", label: "Day" },
];

/** Where the hours went, grouped and filtered in the address, with an export. */
export function ReportsView({ params, go }: { params: URLSearchParams; go: Go }) {
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
        <ReportBody report={report.data} group={group} from={from} to={to} />
      )}
    </>
  );
}

function ReportBody({ report: data, group, from, to }: { report: TimeReport; group: ReportGroup; from: string; to: string }) {
  const max = useMemo(() => Math.max(1, ...data.items.map((item) => item.minutes)), [data]);
  return (
    <>
      <div className="nx-td-kpis">
        <div className="nx-td-kpi"><small>Logged</small><strong>{hours(data.total_minutes)}</strong><span>{dayjs(from).format("D MMM")} – {dayjs(to).format("D MMM")}</span></div>
        <div className="nx-td-kpi"><small>Billable</small><strong>{hours(data.billable_minutes)}</strong>
          <span>{data.total_minutes ? Math.round((data.billable_minutes * 100) / data.total_minutes) : 0}% utilisation</span></div>
        <div className="nx-td-kpi"><small>{GROUPS.find((g) => g.value === group)?.label}s</small><strong>{data.items.length}</strong><span>with time</span></div>
        <div className="nx-td-kpi"><small>Scope</small><strong style={{ fontSize: 18 }}>{data.can_see_everyone ? "Everyone" : "Only you"}</strong><span>{data.can_see_everyone ? "you approve time" : "your own entries"}</span></div>
      </div>
      <Card size="small" title={`By ${GROUPS.find((g) => g.value === group)?.label.toLowerCase()}`}>
        {data.items.length === 0 ? <div className="nx-td-empty">No time in this range.</div> : (
          <div data-testid="time-report">
            {data.items.map((item) => (
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
  );
}
