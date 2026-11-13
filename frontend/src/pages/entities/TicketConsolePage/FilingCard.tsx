import { Card, Descriptions, Tooltip } from "antd";
import { Link } from "react-router-dom";

import type { RecordPage } from "@/components/records/useRecordPage";
import { asText } from "@/lib/text";
import { absoluteTime, relativeTime } from "@/lib/time";

import { formatCount, titleCase } from "./words";

/**
 * The filing. It matters and it is not the job, which is why it is below the
 * controls rather than in the headline — but "unknown channel · data" in a
 * subtitle was information nobody could read and the record's own
 * `project_id` was not shown at all.
 */
export function FilingCard({ page }: { page: RecordPage }) {
  const projectId = asText(page.value("project_id"));
  return (
    <Card size="small" title="Filing" className="nu-block" data-testid="ticket-filing">
      <Descriptions size="small" column={1}>
        <Descriptions.Item label="Category">
          {titleCase(asText(page.value("category"))) || "—"}
        </Descriptions.Item>
        <Descriptions.Item label="Channel">
          {titleCase(asText(page.value("channel"))) || "—"}
        </Descriptions.Item>
        <Descriptions.Item label="Satisfaction">
          {page.value("satisfaction") === null
            ? "Not rated"
            : `${Number(page.value("satisfaction"))}/5`}
        </Descriptions.Item>
        <Descriptions.Item label="Reopened">
          {Number(page.value("reopen_count") ?? 0) === 0
            ? "Never"
            : formatCount(Number(page.value("reopen_count")))}
        </Descriptions.Item>
        <Descriptions.Item label="Project">
          {projectId ? (
            <Link to={`/projects/${projectId}`}>Open the project</Link>
          ) : (
            "Not against a project"
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Last changed">
          <Tooltip title={absoluteTime(asText(page.value("updated_at")))}>
            <span>{relativeTime(asText(page.value("updated_at")))}</span>
          </Tooltip>
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
