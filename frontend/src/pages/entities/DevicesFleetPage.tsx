/**
 * Devices as a fleet monitor (§7, §65).
 *
 * Hardware is watched, not browsed. The questions are "what is down", "what is
 * about to be" and "what have I not heard from" — and all three are about the
 * fleet rather than about any one device, so the page leads with the fleet and
 * lets somebody drill into a unit.
 *
 * Every tile carries **two** health signals, battery and signal strength, drawn
 * as bars rather than printed as numbers: a wall of forty devices is scanned,
 * and a scan reads length far faster than it reads digits. Staleness gets its
 * own colour because a device that has not reported in a week is a different
 * problem from one reporting that it is unwell.
 */

import { Card, Col, Empty, Pagination, Row, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
import { ApiOutlined, ThunderboltOutlined, WifiOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { ChartCard } from "@/components/ChartCard";
import { usePageCommands } from "@/commands/CommandContext";
import { EntityError, EntityFilters, EntityHeader, MetricStrip } from "@/entities/EntityChrome";
import { useEntityView } from "@/entities/useEntityView";
import { absoluteTime, parseInstant, relativeTime } from "@/lib/time";
import { knownStatusColor, SEMANTIC } from "@/theme/tokens";

const { Text } = Typography;

const COLUMNS = [
  "serial", "name", "kind", "model", "manufacturer", "status", "location",
  "last_seen_at", "battery_percent", "signal_strength", "uptime_hours", "error_count",
];

interface DeviceRow {
  id: string;
  serial?: string;
  name?: string;
  kind?: string;
  model?: string;
  manufacturer?: string;
  status?: string;
  location?: string;
  last_seen_at?: string | null;
  battery_percent?: number;
  signal_strength?: number;
  uptime_hours?: number;
  error_count?: number;
}

const DAY = 86_400_000;

/** How stale a reading is, as the three words an operator would use. */
function freshness(lastSeen: string | null | undefined): {
  label: string;
  colour: string;
} {
  const moment = parseInstant(lastSeen);
  if (!moment) return { label: "never reported", colour: SEMANTIC.danger };
  const age = Date.now() - moment.valueOf();
  if (age < DAY) return { label: "reporting", colour: SEMANTIC.success };
  if (age < 7 * DAY) return { label: "quiet", colour: SEMANTIC.warning };
  return { label: "silent", colour: SEMANTIC.danger };
}

/** A bar rather than a number: forty of these are scanned, not read. */
function Gauge({
  label,
  value,
  icon,
  suffix = "%",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  suffix?: string;
}) {
  const colour =
    value >= 60 ? SEMANTIC.success : value >= 25 ? SEMANTIC.warning : SEMANTIC.danger;
  return (
    <Tooltip title={`${label}: ${Math.round(value)}${suffix}`}>
      <div className="nu-gauge">
        <span className="nu-gauge-icon" style={{ color: colour }} aria-hidden>
          {icon}
        </span>
        <span className="nu-gauge-track">
          <span
            className="nu-gauge-fill"
            style={{ width: `${Math.max(0, Math.min(value, 100))}%`, background: colour }}
          />
        </span>
        <span className="nu-gauge-value">{Math.round(value)}</span>
      </div>
    </Tooltip>
  );
}

export default function DevicesFleetPage() {
  const navigate = useNavigate();
  const view = useEntityView("device", {
    columns: COLUMNS,
    defaultSort: "last_seen_at",
    defaultPageSize: 36,
  });
  const rows = (view.rows.data?.items ?? []) as DeviceRow[];
  const insights = view.insights.data;
  const breakdown = (field: string) =>
    insights?.breakdowns.find((item) => item.field === field);

  usePageCommands("entity:device", [
    {
      id: "device.offline",
      label: "Show devices that are offline",
      keywords: "down dead unreachable",
      run: () => view.setFilter("status", "OFFLINE"),
    },
    {
      id: "device.degraded",
      label: "Show degraded devices",
      keywords: "unhealthy warning",
      run: () => view.setFilter("status", "DEGRADED"),
    },
  ]);

  if (view.catalogue.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <EntityHeader
        view={view}
        subtitle="The fleet at a glance — what is up, what is unwell, and what has stopped talking."
      />

      <MetricStrip view={view} accents={["accent", "success", "warning", "danger"]} />

      <Row gutter={[12, 12]} className="nu-block">
        <Col xs={24} lg={8}>
          <ChartCard
            id="devices-status"
            height={200}
            panel={
              breakdown("status") && {
                kind: "pie",
                title: "Fleet by state",
                series: breakdown("status")!.series,
              }
            }
            loading={view.insights.isLoading}
            onSelect={(name) => view.setFilter("status", name)}
          />
        </Col>
        <Col xs={24} lg={8}>
          <ChartCard
            id="devices-kind"
            height={200}
            panel={
              breakdown("kind") && {
                kind: "bar",
                title: "By kind",
                series: breakdown("kind")!.series,
              }
            }
            loading={view.insights.isLoading}
            onSelect={(name) => view.setFilter("kind", name)}
          />
        </Col>
        <Col xs={24} lg={8}>
          <ChartCard
            id="devices-location"
            height={200}
            panel={
              breakdown("location") && {
                kind: "bar",
                title: "By site",
                series: breakdown("location")!.series,
              }
            }
            loading={view.insights.isLoading}
            onSelect={(name) => view.setFilter("location", name)}
          />
        </Col>
      </Row>

      <EntityFilters view={view} only={["status", "kind", "manufacturer", "location"]} />
      <EntityError view={view} />

      {view.rows.isLoading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : rows.length === 0 ? (
        <Card size="small" className="nu-block">
          <Empty description="No devices match these filters" />
        </Card>
      ) : (
        <div className="nu-fleet" data-testid="device-fleet">
          {rows.map((device) => {
            const seen = freshness(device.last_seen_at);
            return (
              <Card
                key={device.id}
                size="small"
                hoverable
                className="nu-device"
                onClick={() => navigate(`/devices/${device.id}`)}
                style={{
                  borderLeft: `3px solid ${knownStatusColor(device.status ?? "") ?? "var(--nu-border)"}`,
                }}
              >
                <div className="nu-device-head">
                  <Text strong ellipsis>
                    {device.name}
                  </Text>
                  <Tag color={knownStatusColor(device.status ?? "")} bordered={false}>
                    {device.status}
                  </Tag>
                </div>

                <Text type="secondary" className="nu-mono nu-device-serial">
                  {device.serial}
                </Text>

                <Gauge
                  label="Battery"
                  value={Number(device.battery_percent ?? 0)}
                  icon={<ThunderboltOutlined />}
                />
                <Gauge
                  label="Signal"
                  value={Number(device.signal_strength ?? 0)}
                  icon={<WifiOutlined />}
                />

                <div className="nu-device-foot">
                  <Tooltip title={absoluteTime(device.last_seen_at)}>
                    <span className="nu-device-seen" style={{ color: seen.colour }}>
                      ● {seen.label} · {relativeTime(device.last_seen_at)}
                    </span>
                  </Tooltip>
                  <Space size={8}>
                    <Text type="secondary">{device.location}</Text>
                    {Number(device.error_count ?? 0) > 0 && (
                      <Tooltip title={`${device.error_count} errors logged`}>
                        <Text type="danger">
                          <ApiOutlined /> {device.error_count}
                        </Text>
                      </Tooltip>
                    )}
                  </Space>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {(view.rows.data?.total ?? 0) > view.pageSize && (
        <div className="nu-notice-pager">
          <Pagination
            current={view.page}
            pageSize={view.pageSize}
            total={view.rows.data?.total ?? 0}
            showSizeChanger
            pageSizeOptions={[18, 36, 72, 144]}
            showTotal={(count, range) => `${range[0]}–${range[1]} of ${count.toLocaleString()}`}
            onChange={(next, size) =>
              view.set({ page: next === 1 ? null : next, page_size: size === 36 ? null : size })
            }
          />
        </div>
      )}
    </>
  );
}
