import { Button, Tag, Tooltip } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";

import type { ReportsPageData } from "../useReportsPage";

/** The title, the counts and the build action. */
export function ReportsHeader({ page }: { page: ReportsPageData }) {
  const { navigate, items, canCreate } = page;
  return (
    <PageHeader
      title="Reports"
      subtitle={[
        `${items.length.toLocaleString()} saved`,
        `${items.filter((item) => item.schedule).length} scheduled`,
        `${items.filter((item) => item.last_run_at && new Date(item.last_run_at).toDateString() === new Date().toDateString()).length} run today`,
      ].join(" · ")}
      tag={<Tag color="blue">{items.length.toLocaleString()} saved</Tag>}
      actions={
        <Tooltip title={canCreate ? "" : "Your role does not include reports.manage"}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!canCreate}
            onClick={() => navigate("/reports/builder")}
            data-testid="new-report"
          >
            Build a report
          </Button>
        </Tooltip>
      }
    />
  );
}
