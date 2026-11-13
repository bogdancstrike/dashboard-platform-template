import { Alert, Button, Descriptions, Space, Tag, Tooltip, Typography } from "antd";
import { PlusOutlined, RedoOutlined, StopOutlined } from "@ant-design/icons";

import type { JobDetail } from "@/api/jobs";
import { absoluteTime } from "@/lib/time";

import { formatDuration, progressLabel, toneFor, whyNot, type Verb } from "./jobFormat";

const { Text } = Typography;

interface JobDetailPaneProps {
  job: JobDetail;
  canManage: boolean;
  busy: boolean;
  onAct: (action: Verb) => void;
}

/**
 * One job in full.
 *
 * Ordered the way somebody investigates: what it was asked to do, how it went,
 * what it said, and then the controls — so a Retry is the last thing reached
 * rather than the first thing clicked.
 */
export function JobDetailPane({ job, canManage, busy, onAct }: JobDetailPaneProps) {
  return (
    <Space direction="vertical" size={16} className="nu-block">
      <div>
        <Space size={8}>
          <Tag color={toneFor(job.status)} bordered={false}>
            {job.status.toLowerCase()}
          </Tag>
          <Tag bordered={false}>
            attempt {job.attempt} of {job.max_attempts}
          </Tag>
          {job.duration_ms !== null && (
            <Tag bordered={false}>{formatDuration(job.duration_ms)}</Tag>
          )}
        </Space>
        <p className="nu-job-detail-name">{job.name}</p>
        <Text type="secondary">{progressLabel(job)}</Text>
      </div>

      {job.error_message && (
        <Alert
          type={job.status === "RETRYING" ? "warning" : "error"}
          showIcon
          data-testid="job-error"
          message={job.status === "RETRYING" ? "Failed, and will be tried again" : "It failed"}
          description={job.error_message}
        />
      )}

      <Descriptions
        size="small"
        column={1}
        bordered
        items={[
          { key: "ref", label: "Reference", children: <Text copyable className="nu-mono">{job.reference}</Text> },
          { key: "kind", label: "Kind", children: job.kind.toLowerCase() },
          { key: "queue", label: "Queue", children: job.queue },
          { key: "priority", label: "Priority", children: job.priority.toLowerCase() },
          { key: "by", label: "Started by", children: job.initiated_by_label ?? "System" },
          {
            key: "queued",
            label: "Queued",
            children: job.created_at ? absoluteTime(job.created_at) : "—",
          },
          {
            key: "started",
            label: "Started",
            children: job.started_at ? absoluteTime(job.started_at) : "not yet",
          },
          {
            key: "finished",
            label: "Finished",
            children: job.finished_at ? absoluteTime(job.finished_at) : "not yet",
          },
        ]}
      />

      <JobOutput job={job} />

      {canManage && <JobControls job={job} busy={busy} onAct={onAct} />}
    </Space>
  );
}

/** What it was asked to do, what it produced, and its own log. */
function JobOutput({ job }: { job: JobDetail }) {
  return (
    <>
      {Object.keys(job.payload).length > 0 && (
        <div>
          <Text strong>What it was asked to do</Text>
          <pre className="nu-log-block" data-testid="job-payload">
            {JSON.stringify(job.payload, null, 2)}
          </pre>
        </div>
      )}

      {job.result && (
        <div>
          <Text strong>What it produced</Text>
          <pre className="nu-log-block" data-testid="job-result">
            {JSON.stringify(job.result, null, 2)}
          </pre>
        </div>
      )}

      {job.log_lines.length > 0 && (
        <div>
          <Text strong>Its own log</Text>
          {job.log_truncated && (
            <Text type="secondary" className="nu-job-truncated">
              {" "}
              — the first {job.log_lines.length}; the rest are in the system log
            </Text>
          )}
          <ul className="nu-job-lines" data-testid="job-lines">
            {job.log_lines.map((line, index) => (
              <li key={`${line.at ?? index}-${index}`}>
                <Text type={line.level === "ERROR" ? "danger" : "secondary"}>
                  {line.level.toLowerCase()}
                </Text>{" "}
                <span>{line.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** Retry, cancel and more attempts — each disabled with its reason. */
function JobControls({ job, busy, onAct }: Omit<JobDetailPaneProps, "canManage">) {
  return (
    <Space size={8}>
      <Tooltip title={whyNot(job, "retry") ?? "Run it again, as the next attempt"}>
        <Button
          icon={<RedoOutlined />}
          disabled={!job.can_retry || busy}
          onClick={() => onAct("retry")}
          data-testid="detail-retry"
        >
          Retry
        </Button>
      </Tooltip>
      <Tooltip title={whyNot(job, "cancel") ?? "Stop it, keeping the row"}>
        <Button
          danger
          icon={<StopOutlined />}
          disabled={!job.can_cancel || busy}
          onClick={() => onAct("cancel")}
          data-testid="detail-cancel"
        >
          Cancel
        </Button>
      </Tooltip>
      {job.can_allow_attempts && (
        <Button
          icon={<PlusOutlined />}
          disabled={busy}
          onClick={() => onAct("grant")}
          data-testid="detail-grant"
        >
          Allow {job.max_attempts + 1} attempts
        </Button>
      )}
    </Space>
  );
}
