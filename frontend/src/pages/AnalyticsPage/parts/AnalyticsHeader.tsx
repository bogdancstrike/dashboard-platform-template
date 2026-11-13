import { Button, Tag } from "antd";
import { ExportOutlined, SearchOutlined } from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";

import type { AnalyticsPageData } from "../useAnalyticsPage";

/** The title and the actions: open in the explorer, save as a report. */
export function AnalyticsHeader({ page }: { page: AnalyticsPageData }) {
  const { navigate, resourceKey, period, groupBy, measureName, kind, headline } = page;
  return (
    <PageHeader
      title="Analytics"
      subtitle={headline.data?.description ?? "Cut any dataset by any column, over any period."}
      tag={
        headline.data ? (
          <Tag color="blue" data-testid="analysis-matched">
            {headline.data.matched.toLocaleString()} rows
          </Tag>
        ) : undefined
      }
      actions={
        <>
          <Button
            icon={<SearchOutlined />}
            onClick={() => navigate(`/explore?resource=${resourceKey}`)}
          >
            See the records
          </Button>
          <Button
            type="primary"
            icon={<ExportOutlined />}
            onClick={() =>
              navigate(
                `/reports/builder?resource=${resourceKey}&group=${groupBy}` +
                  `&period=${period}&chart=${kind}` +
                  (measureName ? `&measure=${measureName}` : ""),
              )
            }
          >
            Save as a report
          </Button>
        </>
      }
    />
  );
}
