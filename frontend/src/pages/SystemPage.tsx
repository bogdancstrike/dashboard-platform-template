import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Card, Col, Descriptions, Row, Space, Table, Typography } from "antd";

import { ApiError } from "@/api/client";
import { healthApi, metaApi, type HealthSnapshot } from "@/api/meta";
import { PageHeader } from "@/components/PageHeader";
import { statusColor } from "@/theme/tokens";

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

/** §24 — the dependency snapshot, unauthenticated, for probes and for people. */
export default function SystemPage() {
  const meta = useQuery({ queryKey: ["meta", "app"], queryFn: ({ signal }) => metaApi.app(signal) });
  const health = useQuery({
    queryKey: ["health", "status"],
    queryFn: ({ signal }) => healthApi.status(signal),
    refetchInterval: 15_000,
  });

  return (
    <>
      <PageHeader
        title="System health"
        subtitle="Every monitored dependency, with latency and the last error each reported."
        tag={
          health.data ? (
            <Badge color={statusColor(health.data.status)} text={health.data.status} />
          ) : undefined
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
          <Card size="small" title="Dependencies" loading={health.isLoading}>
            {health.isError ? (
              <ErrorPanel error={health.error} />
            ) : health.data ? (
              <DependencyTable snapshot={health.data} />
            ) : null}
          </Card>
        </Col>
      </Row>
    </>
  );
}
