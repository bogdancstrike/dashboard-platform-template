import { Alert, Space, Table, Typography } from "antd";

import { ApiError } from "@/api/client";
import type { HealthSnapshot } from "@/api/meta";
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

export function DependencyTable({ snapshot }: { snapshot: HealthSnapshot }) {
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

export function ErrorPanel({ error }: { error: unknown }) {
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
