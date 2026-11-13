import { Descriptions, Space, Tag, Typography } from "antd";

import type { LogEntry } from "@/api/logs";
import { absoluteTime } from "@/lib/time";

import { paceOf, toneFor } from "./logFormat";

const { Text } = Typography;

/**
 * One line in full.
 *
 * The order is the order somebody investigates in: what happened, then which
 * request it belonged to, then the machine detail, then the other lines from
 * the same request — which is usually where the answer is.
 */
export function LineDetail({ entry, onOpen }: { entry: LogEntry; onOpen: (id: string) => void }) {
  return (
    <Space direction="vertical" size={16} className="nu-block">
      <div>
        <Space size={8}>
          <Tag color={toneFor(entry.level)} bordered={false}>
            {entry.level.toLowerCase()}
          </Tag>
          {entry.status_code !== null && <Tag bordered={false}>HTTP {entry.status_code}</Tag>}
          {entry.duration_ms !== null && (
            <Tag bordered={false} color={paceOf(entry.duration_ms) === "slow" ? "warning" : undefined}>
              {Math.round(entry.duration_ms).toLocaleString()} ms
            </Tag>
          )}
        </Space>
        <p className="nu-log-detail-message">{entry.message}</p>
      </div>

      <LineFacts entry={entry} />

      {Object.keys(entry.context).length > 0 && (
        <div>
          <Text strong>Request</Text>
          <pre className="nu-log-block" data-testid="line-context">
            {JSON.stringify(entry.context, null, 2)}
          </pre>
        </div>
      )}

      {entry.stack_trace && (
        <div>
          <Text strong>Stack trace</Text>
          <pre className="nu-log-block nu-log-block--trace" data-testid="line-trace">
            {entry.stack_trace}
          </pre>
        </div>
      )}

      <RelatedLines entry={entry} onOpen={onOpen} />
    </Space>
  );
}

function LineFacts({ entry }: { entry: LogEntry }) {
  return (
    <Descriptions size="small" column={1} bordered items={[
      {
        key: "when",
        label: "When",
        children: entry.logged_at ? absoluteTime(entry.logged_at) : "—",
      },
      { key: "service", label: "Service", children: entry.service },
      { key: "logger", label: "Source", children: entry.logger ?? "—" },
      { key: "environment", label: "Environment", children: entry.environment },
      {
        key: "correlation",
        label: "Correlation ID",
        children: entry.correlation_id ? (
          // Selectable and monospace: this is a value people copy out of one
          // screen and paste into another.
          <Text copyable className="nu-mono">
            {entry.correlation_id}
          </Text>
        ) : (
          "—"
        ),
      },
      ...(entry.trace_id
        ? [
            {
              key: "trace",
              label: "Trace ID",
              children: (
                <Text copyable className="nu-mono">
                  {entry.trace_id}
                </Text>
              ),
            },
          ]
        : []),
      ...(entry.host ? [{ key: "host", label: "Host", children: entry.host }] : []),
    ]} />
  );
}

/** The other lines logged under the same correlation id — usually where the answer is. */
function RelatedLines({ entry, onOpen }: { entry: LogEntry; onOpen: (id: string) => void }) {
  return (
    <div>
      <Text strong>
        The rest of this request{" "}
        <Text type="secondary">
          ({entry.related.length} other {entry.related.length === 1 ? "line" : "lines"})
        </Text>
      </Text>
      {entry.related.length === 0 ? (
        <p>
          <Text type="secondary">
            {entry.correlation_id
              ? "Nothing else was logged under this correlation id."
              : "This line carries no correlation id, so it cannot be tied to a request."}
          </Text>
        </p>
      ) : (
        <ul className="nu-log-related" data-testid="line-related">
          {entry.related.map((sibling) => (
            <li key={sibling.id}>
              <button type="button" onClick={() => onOpen(sibling.id)}>
                <Tag color={toneFor(sibling.level)} bordered={false}>
                  {sibling.level.toLowerCase()}
                </Tag>
                <span className="nu-log-related-message">{sibling.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
