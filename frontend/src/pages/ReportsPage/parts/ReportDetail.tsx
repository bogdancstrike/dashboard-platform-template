import { Button, Card, Dropdown, Segmented, Space, Tag, Tooltip, Typography } from "antd";
import {
  CopyOutlined,
  DashboardOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import { panelFor } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import { ChartCard } from "@/components/ChartCard";
import { FailureAlert } from "@/components/FailureAlert";
import { EmptyState } from "@/components/EmptyState";

import { ScopeTag } from "../model";
const { Text } = Typography;

import type { ReportsPageData } from "../useReportsPage";

/** The chosen report, answered: its picture, its table, its actions. */
export function ReportDetail({ page }: { page: ReportsPageData }) {
  const { navigate, modal, setPinning, dashboardsOn, open, run, duplicate, remove, rerun } = page;
  return (
    <Card
      size="small"
      className="nu-pane nu-split-detail nx-ov-reportdetail"
      title={open?.name ?? "Pick a report"}
      extra={
        open && (
          <Space>
            <Button
              icon={<ReloadOutlined />}
              loading={run.isFetching}
              onClick={() => void run.refetch()}
            >
              Run again
            </Button>
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "edit",
                    icon: <EditOutlined />,
                    label: open.can_edit ? "Edit" : "Edit — only the owner may",
                    disabled: !open.can_edit,
                  },
                  ...(dashboardsOn
                    ? [
                        {
                          key: "dashboard",
                          icon: <DashboardOutlined />,
                          label: "Add to a dashboard",
                        },
                      ]
                    : []),
                  { key: "duplicate", icon: <CopyOutlined />, label: "Duplicate" },
                  {
                    key: "delete",
                    icon: <DeleteOutlined />,
                    label: open.can_edit ? "Delete" : "Delete — only the owner may",
                    disabled: !open.can_edit,
                    danger: open.can_edit,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === "edit") navigate(`/reports/builder?id=${open.id}`);
                  // The saved report itself goes on the dashboard, not a
                  // copy of its question (§45).
                  else if (key === "dashboard")
                    setPinning({ kind: "REPORT", id: open.id, title: open.name });
                  else if (key === "duplicate") duplicate.mutate(open.id);
                  else
                    modal.confirm({
                      title: `Delete ${open.name}?`,
                      content: "Anybody it was shared with loses it too.",
                      okText: "Delete",
                      okButtonProps: { danger: true },
                      onOk: () => remove.mutateAsync(open.id),
                    });
                },
              }}
            >
              <Button icon={<MoreOutlined />} aria-label={`Actions for ${open.name}`} />
            </Dropdown>
          </Space>
        )
      }
    >
      {!open ? (
        <EmptyState title="Choose a report from the list" />
      ) : run.isError ? (
        <FailureAlert
          error={run.error}
          titles={{
            forbidden: "Your role does not include this report",
            not_found: "That report has been deleted",
            failed: "That report could not be run",
          }}
          onRetry={() => void run.refetch()}
        />
      ) : (
        <>
          {/* One line of provenance and one control, so the answer starts
              as high on the page as it can. This was four stacked blocks
              — tags, a description, a period strip, then the chart — and
              the chart got what was left. */}
          <div className="nu-report-meta">
            <Space size={8} wrap>
              <ScopeTag report={open} />
              <Text type="secondary">by {open.owner.name}</Text>
              <Text type="secondary">·</Text>
              <Text type="secondary">run {open.run_count.toLocaleString()} times</Text>
              <Text type="secondary">·</Text>
              <Text type="secondary" data-testid="report-matched">
                {(run.data?.result.matched ?? 0).toLocaleString()} rows measured
              </Text>
              {open.members.length > 0 && (
                <Tooltip title={open.members.map((member) => member.name).join(", ")}>
                  <Tag bordered={false}>{open.members.length} members</Tag>
                </Tooltip>
              )}
            </Space>

            <Segmented
              size="small"
              aria-label="Period"
              value={run.data?.result.period.key ?? open.period}
              onChange={(next) => void rerun(String(next))}
              options={[
                { value: "last_30_days", label: "30 days" },
                { value: "last_90_days", label: "90 days" },
                { value: "last_365_days", label: "A year" },
                { value: "all_time", label: "All time" },
              ]}
            />
          </div>

          {open.description && (
            <Text type="secondary" className="nu-report-description">
              {open.description}
            </Text>
          )}

          <ChartCard
            id={`report-${open.id}`}
            className="nu-chartcard--fill"
            height="100%"
            loading={run.isLoading}
            panel={panelFor(
              run.data?.result,
              (open.visualization === "table" ? "bar" : open.visualization) as ChartKind,
              undefined,
              run.data?.result.description,
            )}
          />
        </>
      )}
    </Card>
  );
}
