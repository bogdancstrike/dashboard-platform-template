import { Button, Card, Progress, Space, Tooltip, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";

import { importsApi, type ImportDetail, type ImportRun } from "@/api/imports";
import { formatNumber } from "@/lib/formats";

import { PreviewTable } from "./PreviewTable";
import { whyNotExecute } from "./importCopy";

const { Text } = Typography;

/** The checked rows, their counts, the problems as a file, and the import itself. */
export function PreviewCard({ run, executing, onExecute }: { run: ImportDetail; executing: boolean; onExecute: () => void }) {
  return (
    <Card
      size="small"
      title="What the rows look like"
      className="nu-imp-preview"
      data-testid="import-preview"
      extra={
        <Space>
          {run.error_count ? (
            <Button
              icon={<DownloadOutlined />}
              data-testid="download-problems"
              onClick={() => void importsApi.problems(run.id, run.reference)}
            >
              {run.error_count === 1
                ? "1 problem, as a file"
                : `${formatNumber(run.error_count)} problems, as a file`}
            </Button>
          ) : null}
          <Tooltip
            // Disabled with the reason rather than absent: executing is
            // what somebody came to do (§76).
            title={run.can_execute ? "" : whyNotExecute(run)}
          >
            <Button
              type="primary"
              data-testid="execute-import"
              disabled={!run.can_execute || run.status === "RUNNING"}
              loading={executing || run.status === "RUNNING"}
              onClick={onExecute}
            >
              {run.valid_rows
                ? `Import ${formatNumber(run.valid_rows)} rows`
                : "Import"}
            </Button>
          </Tooltip>
        </Space>
      }
    >
      <Counts run={run} />
      {run.status === "RUNNING" ? (
        // Decoration: the percentage is invented (a run in progress has
        // no measured one) and "RUNNING" is already said by the status
        // beside it. A bar announcing "99%" would be a number the server
        // never reported.
        <Progress percent={99} status="normal" showInfo={false} aria-hidden="true" />
      ) : null}
      <PreviewTable run={run} />
    </Card>
  );
}

/** The four counts, side by side, so they can be seen to add up. */
function Counts({ run }: { run: ImportRun }) {
  return (
    <Space className="nu-imp-counts" size={16} data-testid="import-counts">
      <span>
        <Text type="secondary">Ready </Text>
        <Text strong>{formatNumber(run.valid_rows)}</Text>
      </span>
      <span>
        <Text type="secondary">To fix </Text>
        <Text strong type={run.invalid_rows ? "warning" : undefined}>
          {formatNumber(run.invalid_rows)}
        </Text>
      </span>
      <span>
        <Text type="secondary">Nothing mapped </Text>
        <Text strong>{formatNumber(run.skipped_rows)}</Text>
      </span>
      <span>
        <Text type="secondary">of </Text>
        <Text strong>{formatNumber(run.total_rows)}</Text>
        <Text type="secondary"> rows</Text>
      </span>
    </Space>
  );
}
