import { Alert, Descriptions, Typography } from "antd";

import type { ExportCatalogue, ExportRow } from "@/api/exports";
import { readableSize } from "@/api/files";
import { formatNumber } from "@/lib/formats";
import { absoluteTime } from "@/lib/time";

import { situation, tone } from "./exportCopy";

const { Text } = Typography;

/** One export, in full. */
export function ExportDetail({
  row,
  catalogue,
}: {
  row: ExportRow;
  catalogue: ExportCatalogue | undefined;
}) {
  return (
    <div className="nu-exp-detail" data-testid="export-detail">
      <Alert
        type={tone(row) === "error" ? "error" : tone(row) === "warning" ? "warning" : "info"}
        showIcon
        data-testid="export-situation"
        message={situation(row)}
        description={row.error_message ?? row.description}
      />

      <Descriptions column={1} size="small" className="nu-exp-facts">
        <Descriptions.Item label="Dataset">{row.resource_type}</Descriptions.Item>
        <Descriptions.Item label="Format">{row.format.toUpperCase()}</Descriptions.Item>
        <Descriptions.Item label="Columns">{row.columns.join(", ") || "—"}</Descriptions.Item>
        <Descriptions.Item label="Rows">
          {row.rows === null ? "—" : formatNumber(row.rows)}
        </Descriptions.Item>
        <Descriptions.Item label="Size">
          {row.size_bytes === null ? "—" : readableSize(row.size_bytes)}
        </Descriptions.Item>
        <Descriptions.Item label="Requested">{absoluteTime(row.requested_at)}</Descriptions.Item>
        <Descriptions.Item label="Finished">
          {row.finished_at ? absoluteTime(row.finished_at) : "—"}
        </Descriptions.Item>
        <Descriptions.Item label="File kept until">
          {row.expires_at
            ? absoluteTime(row.expires_at)
            : catalogue
              ? `${catalogue.retention_days} days after it finishes`
              : "—"}
        </Descriptions.Item>
        {/* Which of the platform's background mechanisms produced it. Said out
            loud because "background" hides three different things, and an
            operator reading a slow export needs to know which one they have. */}
        <Descriptions.Item label="Produced by">{row.ran_as || "—"}</Descriptions.Item>
      </Descriptions>

      {row.log_lines.length ? (
        <div className="nu-exp-log" data-testid="export-log">
          {row.log_lines.map((line, index) => (
            <div key={`${line.at ?? index}`} className="nu-exp-log-line">
              <Text type="secondary">{line.at ? absoluteTime(line.at) : ""}</Text>
              <Text type={line.level === "ERROR" ? "danger" : undefined}>{line.message}</Text>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
