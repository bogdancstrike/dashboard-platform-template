import { Button, Space, Tooltip } from "antd";
import { SaveOutlined } from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";
import { draftIsRunnable } from "@/entities/analysisDraft";

import type { ChartBuilderPageData } from "../useChartBuilderPage";

/** The title and the save actions. */
export function BuilderHeader({ page }: { page: ChartBuilderPageData }) {
  const { navigate, params, setSaving, editingId, stored, draft, chosen, blocked } = page;
  return (
    <PageHeader
      title={
        editingId ? (
          `Edit ${stored?.name ?? "chart"}`
        ) : (
          <span>
            Chart <em>builder</em>
          </span>
        )
      }
      subtitle="Pick a picture and it will tell you what it needs. Every kind is drawn from your own data, in both themes."
      onBack={() => navigate("/reports")}
      actions={
        <Space size={8}>
          <Button onClick={() => navigate(`/reports/builder?${params.toString()}`)}>
            Open in the report builder
          </Button>
          <Tooltip
            title={
              !draftIsRunnable(draft)
                ? "Pick a column to measure first"
                : blocked
                  ? `${chosen?.label} ${blocked}`
                  : ""
            }
          >
            <Button
              type="primary"
              icon={<SaveOutlined />}
              disabled={!draftIsRunnable(draft) || Boolean(blocked)}
              onClick={() => setSaving(true)}
              data-testid="open-save-chart"
            >
              {editingId ? "Save changes" : "Save chart"}
            </Button>
          </Tooltip>
        </Space>
      }
    />
  );
}
