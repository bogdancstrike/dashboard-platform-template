/**
 * One dependency, across a window of time (§24).
 *
 * The health page could only say what was true *now*, which is the question a
 * deploy pipeline asks. The question a person on this page is almost always
 * asking is the other one — **was it working at four o'clock**, when the thing
 * they are investigating happened — and a page that cannot answer it leaves
 * the incident to be reconstructed from memory.
 *
 * Three decisions worth stating.
 *
 * **Latency is the line; status is the ground under it.** Drawing status as a
 * second line would put two unrelated scales on one axis. Painting it as bands
 * behind the latency says the two things a reader needs at once: how slow it
 * was, and whether anybody would have noticed.
 *
 * **An outage is a period, not a run of points.** "Unavailable at 04:00, 05:00
 * and 06:00" is one incident, and listing it three times makes an outage look
 * like three. The server collapses consecutive not-healthy points; this draws
 * what it collapsed.
 *
 * **Two uptime numbers, both named.** The row carries a lifetime figure and
 * the window has its own, and they are usually different. Showing one of them
 * unlabelled is how a number gets quoted wrongly in a report.
 */

import { Empty, Space, Tag, Tooltip, Typography } from "antd";

import type { ServiceHistory } from "@/api/meta";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { absoluteTime, relativeTime } from "@/lib/time";
import { statusColor } from "@/theme/tokens";

const { Text } = Typography;

export function ServiceHistoryCard({ service }: { service: ServiceHistory }) {
  const points = service.series;

  return (
    <section className="nu-health-service" data-testid={`health-${service.key}`}>
      <header className="nu-health-head">
        <span className="nu-health-name">
          <span
            className="nu-health-dot"
            style={{ background: statusColor(service.status) }}
            aria-hidden
          />
          <Text strong>{service.name}</Text>
          <Text type="secondary" className="nu-health-category">
            {service.category.toLowerCase()}
          </Text>
        </span>

        <Space size={6} wrap>
          {/* Named, because the row's lifetime figure and the window's are
              usually different and an unlabelled one gets quoted wrongly. */}
          <Tooltip title="Healthy checks in the window you are looking at">
            <Tag bordered={false} color={service.window_uptime_percent >= 99 ? "success" : "warning"}>
              {service.window_uptime_percent}% in view
            </Tag>
          </Tooltip>
          <Tooltip title="The figure recorded against the service itself, over its lifetime">
            <Tag bordered={false}>{service.uptime_percent}% lifetime</Tag>
          </Tooltip>
          {service.last_checked_at && (
            <Tooltip title={absoluteTime(service.last_checked_at)}>
              <Text type="secondary" className="nu-health-when">
                checked {relativeTime(service.last_checked_at)}
              </Text>
            </Tooltip>
          )}
        </Space>
      </header>

      {points.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text type="secondary">Nothing recorded in this window</Text>
          }
        />
      ) : (
        <>
          <ChartPreview
            panel={{
              kind: "line",
              title: `${service.name} latency`,
              series: points.map((point) => ({
                name: absoluteTime(point.at),
                value: Math.round(point.latency_ms),
              })),
            }}
            height={120}
            label={`${service.name}: latency across the window, ${points.length} readings`}
          />

          {/* The status band. A row of segments under the line, one per
              reading, so a reader can see *when* it was bad without reading
              the axis — and it is a second carrier for a fact the line only
              hints at through height (§55). */}
          <div
            className="nu-health-band"
            role="img"
            aria-label={`${service.name}: ${service.incidents.length} periods of trouble in this window`}
          >
            {points.map((point) => (
              <Tooltip
                key={point.at}
                title={`${absoluteTime(point.at)} · ${point.status.toLowerCase()} · ${Math.round(point.latency_ms)} ms`}
              >
                <span
                  className="nu-health-tick"
                  style={{ background: statusColor(point.status) }}
                />
              </Tooltip>
            ))}
          </div>
        </>
      )}

      {service.incidents.length > 0 && (
        <ul className="nu-health-incidents">
          {service.incidents.slice(0, 4).map((incident) => (
            <li key={`${incident.status}-${incident.started_at}`}>
              <Tag bordered={false} color={incident.status === "UNAVAILABLE" ? "error" : "warning"}>
                {incident.status.toLowerCase()}
              </Tag>
              <Text type="secondary">
                {absoluteTime(incident.started_at)}
                {incident.points > 1 ? ` — ${absoluteTime(incident.ended_at)}` : ""}
              </Text>
            </li>
          ))}
          {service.incidents.length > 4 && (
            <li>
              <Text type="secondary">
                and {service.incidents.length - 4} more in this window
              </Text>
            </li>
          )}
        </ul>
      )}

      {service.message && (
        <Text type="secondary" className="nu-health-message">
          {service.message}
        </Text>
      )}
    </section>
  );
}
