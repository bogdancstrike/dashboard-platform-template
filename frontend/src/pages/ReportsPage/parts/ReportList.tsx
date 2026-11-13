import { Button, Card, Input, Table, Tag, Tooltip, Typography } from "antd";

import type { SavedReport } from "@/api/reports";
import { EmptyState } from "@/components/EmptyState";
import { NxIcon } from "@/components/NxIcon";
import { relativeTime } from "@/lib/time";

import { SCOPES } from "../model";
const { Text } = Typography;

import type { ReportsPageData } from "../useReportsPage";

/** The saved reports, one row each, searchable. */
export function ReportList({ page }: { page: ReportsPageData }) {
  const { navigate, term, setTerm, items, openId, which, setWhich, filtered, choose, canCreate } =
    page;
  return (
    <>
      {/* The reports as the canvas lays them out — one table, a row each,
          with what the server knows about them in columns. The chosen row
          is answered underneath, so the page still opens on an answer
          rather than on a list of names. */}
      <Card size="small" className="nx-ov-reportlist">
        <div className="nx-ov-filterbar nx-ov-filterbar--inset" role="search">
          <Input
            allowClear
            variant="filled"
            prefix={<NxIcon name="search" size={16} />}
            placeholder="Search reports"
            aria-label="Filter reports"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
        <div className="nu-kindstrip nx-ov-kinds" aria-label="Which reports">
          {(
            [
              ["all", "All", items.length],
              ["scheduled", "Scheduled", items.filter((item) => item.schedule).length],
              ["mine", "Mine", items.filter((item) => item.can_edit).length],
              ["shared", "Shared with me", items.filter((item) => !item.can_edit).length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              className={`nu-kindchip${which === key ? " is-active" : ""}${count === 0 ? " is-empty" : ""}`}
              aria-pressed={which === key}
              disabled={count === 0 && key !== "all"}
              onClick={() => setWhich(key)}
            >
              <span className="nu-kindchip-label">{label}</span>
              <span className="nu-kindchip-count">{count}</span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          items.length === 0 ? (
            <EmptyState
              title="No reports yet"
              hint="A report is a saved analysis — a dataset, a way to cut it and a period."
              action={
                canCreate ? (
                  <Button type="primary" onClick={() => navigate("/reports/builder")}>
                    Build the first one
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState title={term ? `Nothing matches “${term}”` : "Nothing in this view"} />
          )
        ) : (
          <Table<SavedReport>
            rowKey="id"
            dataSource={filtered}
            size="middle"
            pagination={
              filtered.length > 6 ? { pageSize: 6, size: "small", showSizeChanger: false } : false
            }
            rowClassName={(report) => `nu-queue-row${report.id === openId ? " is-open" : ""}`}
            onRow={(report) => ({
              onClick: () => choose(report.id),
              onKeyDown: (event) => {
                if (event.key === "Enter") choose(report.id);
              },
              tabIndex: 0,
              "aria-current": report.id === openId,
            })}
            scroll={{ x: 640 }}
            columns={[
              {
                key: "report",
                title: "Report",
                render: (_, report) => (
                  <span className="nu-queue-main">
                    <span className="nu-queue-title">
                      <Text strong ellipsis>
                        {report.name}
                      </Text>
                      {/* Only the exceptions carry a mark: private is the
                          default, and a label every row shares is a label
                          nobody reads. */}
                      {report.scope !== "PRIVATE" && (
                        <Tooltip title={SCOPES[report.scope]?.label}>
                          <span className="nu-queue-scope" aria-label={SCOPES[report.scope]?.label}>
                            {SCOPES[report.scope]?.icon}
                          </span>
                        </Tooltip>
                      )}
                    </span>
                    <Text type="secondary" className="nx-ov-sub">
                      {[
                        report.can_edit ? "You" : report.owner.name,
                        report.resource_type.replace(/_/g, " "),
                      ].join(" · ")}
                    </Text>
                  </span>
                ),
              },
              {
                key: "schedule",
                title: "Schedule",
                width: 170,
                render: (_, report) =>
                  report.schedule ? (
                    <Text>{report.schedule}</Text>
                  ) : (
                    <Text type="secondary">Not scheduled</Text>
                  ),
              },
              {
                key: "chart",
                title: "Chart",
                width: 110,
                render: (_, report) => (
                  <Tag bordered={false} className="nx-ov-pill">
                    {report.visualization.replace(/[-_]/g, " ")}
                  </Tag>
                ),
              },
              {
                key: "runs",
                title: "Runs",
                width: 80,
                align: "right",
                render: (_, report) => report.run_count.toLocaleString(),
              },
              {
                key: "last",
                title: "Last run",
                width: 130,
                render: (_, report) =>
                  report.last_run_at ? (
                    relativeTime(report.last_run_at)
                  ) : (
                    <Text type="secondary">Never</Text>
                  ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
