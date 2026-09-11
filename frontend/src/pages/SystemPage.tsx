import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Row,
  Segmented,
  Space,
  Table,
  Typography,
} from "antd";
import type { Dayjs } from "dayjs";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { healthApi, metaApi, type HealthSnapshot } from "@/api/meta";
import { PageHeader } from "@/components/PageHeader";
import { ServiceHistoryCard } from "@/components/health/ServiceHistoryCard";
import { absoluteTime } from "@/lib/time";
import { statusColor } from "@/theme/tokens";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

function StatusDot({ status }: { status: string }) {
  return (
    <Space size={6}>
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: 999,
          background: statusColor(status),
        }}
      />
      <Text>{status}</Text>
    </Space>
  );
}

function DependencyTable({ snapshot }: { snapshot: HealthSnapshot }) {
  const rows = Object.entries(snapshot.checks).map(([name, check]) => ({
    key: name,
    name,
    status: check.status,
    latency: check.latency_ms,
    error: check.error ?? "",
  }));

  return (
    <Table
      size="small"
      data-testid="dependency-table"
      pagination={false}
      dataSource={rows}
      columns={[
        { title: "Dependency", dataIndex: "name", width: 160 },
        {
          title: "Status",
          dataIndex: "status",
          width: 150,
          render: (value: string) => <StatusDot status={value} />,
        },
        {
          title: "Latency",
          dataIndex: "latency",
          width: 110,
          align: "right" as const,
          render: (value: number | null) => (value === null ? "—" : `${value} ms`),
        },
        { title: "Detail", dataIndex: "error", ellipsis: true },
      ]}
    />
  );
}

function ErrorPanel({ error }: { error: unknown }) {
  const apiError = error instanceof ApiError ? error : null;
  return (
    <Alert
      type="error"
      showIcon
      message={apiError ? apiError.message : "Could not reach the API"}
      description={
        <Space direction="vertical" size={4}>
          <Text type="secondary">
            {apiError
              ? `${apiError.status} ${apiError.code}`
              : "The dev server proxies /platform to the backend — is it running?"}
          </Text>
          {apiError && (
            // The id the server logged this against. A screenshot carrying it
            // is a failure somebody can find; one without it is a guess.
            <Text code copyable={{ text: apiError.correlationId }}>
              {apiError.correlationId}
            </Text>
          )}
        </Space>
      }
    />
  );
}

/** How each window is named on the control. */
const PERIOD_LABELS: Record<string, string> = {
  "8h": "8 hours",
  "1d": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

/**
 * §24 — the dependency snapshot, and what each dependency has been doing.
 *
 * The page said only what was true *now*. That is the right answer for a
 * deploy pipeline and the wrong one for a person, who is almost always here
 * because something happened earlier and they want to know whether the
 * platform was part of it.
 */
export default function SystemPage() {
  const [period, setPeriod] = useState("1d");
  /** A custom window, as two moments. Empty until somebody picks one. */
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  const meta = useQuery({ queryKey: ["meta", "app"], queryFn: ({ signal }) => metaApi.app(signal) });
  const health = useQuery({
    queryKey: ["health", "status"],
    queryFn: ({ signal }) => healthApi.status(signal),
    refetchInterval: 15_000,
  });

  const window = range
    ? { from: range[0].toISOString(), to: range[1].toISOString() }
    : { period };
  const history = useQuery({
    queryKey: ["health", "history", window],
    queryFn: ({ signal }) => healthApi.history(window, signal),
    // Slower than the snapshot on purpose: a month of history does not change
    // meaningfully every fifteen seconds, and refetching it that often would
    // redraw eight charts under somebody's pointer.
    refetchInterval: 60_000,
  });

  return (
    <>
      <PageHeader
        title="System health"
        subtitle="Every monitored dependency: what it is doing now, and what it has been doing."
        tag={
          health.data ? (
            <Badge color={statusColor(health.data.status)} text={health.data.status} />
          ) : undefined
        }
        actions={
          <Space size={8} wrap>
            <Segmented
              aria-label="Window"
              value={range ? "custom" : period}
              onChange={(next) => {
                // Choosing a named window clears the custom one, because two
                // windows in play is a page that cannot say which it drew.
                setRange(null);
                setPeriod(String(next));
              }}
              options={[
                ...(history.data?.periods ?? ["8h", "1d", "7d", "30d"]).map((key) => ({
                  value: key,
                  label: PERIOD_LABELS[key] ?? key,
                })),
                { value: "custom", label: "Custom", disabled: !range },
              ]}
            />
            <DatePicker.RangePicker
              showTime
              aria-label="Custom window"
              value={range}
              onChange={(value) =>
                setRange(value && value[0] && value[1] ? [value[0], value[1]] : null)
              }
              data-testid="health-range"
            />
          </Space>
        }
      />

      {meta.isError && <ErrorPanel error={meta.error} />}

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={10}>
          <Card size="small" title="Service" loading={meta.isLoading}>
            {meta.data && (
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="Version">{meta.data.version}</Descriptions.Item>
                <Descriptions.Item label="Build">{meta.data.build}</Descriptions.Item>
                <Descriptions.Item label="Environment">{meta.data.environment}</Descriptions.Item>
                <Descriptions.Item label="Realm">{meta.data.auth.realm}</Descriptions.Item>
                <Descriptions.Item label="Client">{meta.data.auth.client_id}</Descriptions.Item>
                <Descriptions.Item label="Issuer">{meta.data.auth.issuer}</Descriptions.Item>
                <Descriptions.Item label="Uptime">
                  {health.data ? `${Math.round(health.data.uptime_seconds)}s` : "—"}
                </Descriptions.Item>
              </Descriptions>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card size="small" title="Dependencies right now" loading={health.isLoading}>
            {health.isError ? (
              <ErrorPanel error={health.error} />
            ) : health.data ? (
              <DependencyTable snapshot={health.data} />
            ) : null}
          </Card>
        </Col>

        <Col xs={24}>
          <Card
            size="small"
            title="What each of them has been doing"
            data-testid="health-history"
            loading={history.isLoading}
            extra={
              history.data ? (
                <Text type="secondary">
                  {absoluteTime(history.data.from)} — {absoluteTime(history.data.to)} ·{" "}
                  {history.data.counts.incidents === 0
                    ? "nothing went wrong"
                    : `${history.data.counts.incidents} ${
                        history.data.counts.incidents === 1 ? "period" : "periods"
                      } of trouble`}
                </Text>
              ) : undefined
            }
          >
            {history.isError ? (
              <ErrorPanel error={history.error} />
            ) : (history.data?.services.length ?? 0) === 0 ? (
              <EmptyState compact title="No service has recorded anything in this window" />
            ) : (
              <div className="nu-health-grid">
                {(history.data?.services ?? []).map((service) => (
                  <ServiceHistoryCard key={service.key} service={service} />
                ))}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}
