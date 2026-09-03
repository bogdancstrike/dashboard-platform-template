/**
 * The application root.
 *
 * Currently one route: a system page that proves the wiring end to end — the
 * API client, the correlation id, the error envelope, the theme and the density
 * switch. The app shell and the real routes land in the next slice; this page
 * stays as `/system`, because "is the backend actually reachable from the
 * browser, and what does it say" is a question worth being able to answer
 * without opening a terminal.
 */

import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Card,
  Descriptions,
  Flex,
  Segmented,
  Space,
  Spin,
  Statistic,
  Table,
  Typography,
} from "antd";

import { ApiError } from "@/api/client";
import { healthApi, metaApi, type HealthSnapshot } from "@/api/meta";
import { useAppearance } from "@/theme/AppearanceProvider";
import { statusColor, type Density } from "@/theme/tokens";

const { Title, Text } = Typography;

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
      pagination={false}
      dataSource={rows}
      columns={[
        { title: "Dependency", dataIndex: "name", width: 160 },
        {
          title: "Status",
          dataIndex: "status",
          width: 160,
          render: (value: string) => <StatusDot status={value} />,
        },
        {
          title: "Latency",
          dataIndex: "latency",
          width: 120,
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
              : "The development server proxies /platform to http://localhost:5101 — is the backend running?"}
          </Text>
          {apiError ? (
            // The id the server logged this against. A screenshot carrying it
            // is a failure somebody can find; one without it is a guess.
            <Text code copyable={{ text: apiError.correlationId }}>
              {apiError.correlationId}
            </Text>
          ) : null}
        </Space>
      }
    />
  );
}

export default function App() {
  const { appearance, setAppearance, density, setDensity } = useAppearance();

  const meta = useQuery({ queryKey: ["meta", "app"], queryFn: ({ signal }) => metaApi.app(signal) });
  const health = useQuery({
    queryKey: ["health", "status"],
    queryFn: ({ signal }) => healthApi.status(signal),
    refetchInterval: 15_000,
  });

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <Flex justify="space-between" align="center" wrap gap={16} style={{ marginBottom: 24 }}>
        <Space direction="vertical" size={0}>
          <Title level={3} style={{ margin: 0 }}>
            {meta.data?.name ?? "Nucleus"}
          </Title>
          <Text type="secondary">{meta.data?.description ?? "Loading…"}</Text>
        </Space>
        <Space size={16} wrap>
          <Space size={8}>
            <Text type="secondary">Appearance</Text>
            <Segmented
              value={appearance}
              onChange={(value) => setAppearance(value as typeof appearance)}
              options={[
                { label: "Light", value: "light" },
                { label: "Dark", value: "dark" },
                { label: "System", value: "system" },
              ]}
            />
          </Space>
          <Space size={8}>
            <Text type="secondary">Density</Text>
            <Segmented
              value={density}
              onChange={(value) => setDensity(value as Density)}
              options={[
                { label: "Compact", value: "compact" },
                { label: "Middle", value: "middle" },
                { label: "Comfortable", value: "comfortable" },
              ]}
            />
          </Space>
        </Space>
      </Flex>

      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {meta.isError ? <ErrorPanel error={meta.error} /> : null}

        <Card title="Service">
          {meta.isLoading ? (
            <Spin />
          ) : meta.data ? (
            <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered>
              <Descriptions.Item label="Version">{meta.data.version}</Descriptions.Item>
              <Descriptions.Item label="Build">{meta.data.build}</Descriptions.Item>
              <Descriptions.Item label="Environment">{meta.data.environment}</Descriptions.Item>
              <Descriptions.Item label="Realm">{meta.data.auth.realm}</Descriptions.Item>
              <Descriptions.Item label="Client">{meta.data.auth.client_id}</Descriptions.Item>
              <Descriptions.Item label="Issuer">{meta.data.auth.issuer}</Descriptions.Item>
            </Descriptions>
          ) : null}
        </Card>

        <Card
          title={
            <Space>
              Dependencies
              {health.data ? (
                <Badge color={statusColor(health.data.status)} text={health.data.status} />
              ) : null}
            </Space>
          }
          extra={
            health.data ? (
              <Statistic
                value={Math.round(health.data.uptime_seconds)}
                suffix="s uptime"
                valueStyle={{ fontSize: 14 }}
              />
            ) : null
          }
        >
          {health.isLoading ? (
            <Spin />
          ) : health.isError ? (
            <ErrorPanel error={health.error} />
          ) : health.data ? (
            <DependencyTable snapshot={health.data} />
          ) : null}
        </Card>
      </Space>
    </main>
  );
}
