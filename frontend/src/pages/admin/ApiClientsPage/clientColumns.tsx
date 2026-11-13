import { Space, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { ApiClientRow } from "@/api/apiClients";
import type { RowCard } from "@/components/listing/ResponsiveTable";
import { StatusTag } from "@/components/StatusTag";
import { formatNumber } from "@/lib/formats";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text } = Typography;

export const clientColumns: ColumnsType<ApiClientRow> = [
  {
    title: "Client",
    dataIndex: "name",
    width: 280,
    render: (name: string, row) => (
      <div className="nu-api-what">
        <Space size={6}>
          <Text strong>{name}</Text>
          <StatusTag status={row.status} />
        </Space>
        <Text type="secondary" className="nu-api-id">
          {row.client_id}
        </Text>
      </div>
    ),
  },
  {
    title: "Keys",
    dataIndex: "live_credentials",
    width: 108,
    render: (live: number, row) => (
      <Text type={live === 0 ? "warning" : undefined} className="nu-api-keys">
        {/* A client with no live key cannot call at all, which is worth
            saying rather than showing as "0 of 3". */}
        {live === 0 ? "none live" : `${live} of ${row.credential_count}`}
      </Text>
    ),
  },
  {
    title: "Scopes",
    dataIndex: "scopes",
    // No fixed width: the scopes take what is left and wrap to two lines.
    // A single no-wrap line widened the whole table, squeezed the client's
    // name to "connecto / r" and pushed Requests and Last used off screen.
    render: (values: string[]) =>
      values.length === 0 ? (
        <Text type="secondary" className="nu-api-scopes">none</Text>
      ) : (
        <Tooltip title={values.join(", ")}>
          <Text className="nu-api-scopes">{values.join(", ")}</Text>
        </Tooltip>
      ),
  },
  {
    title: "Requests",
    dataIndex: "requests_total",
    width: 132,
    align: "right",
    render: (total: number, row) => (
      <Tooltip title="Lifetime, counted by the gateway — not the request log below.">
        <Text type="secondary" className="nu-api-count">
          {formatNumber(total)}
          {row.error_rate > 0 && (
            <>
              <br />
              {(row.error_rate * 100).toFixed(1)}% errors
            </>
          )}
        </Text>
      </Tooltip>
    ),
  },
  {
    title: "Last used",
    dataIndex: "last_used_at",
    width: 130,
    render: (value: string | null) =>
      value ? (
        <Tooltip title={absoluteTime(value)}>
          <Text type="secondary">{relativeTime(value)}</Text>
        </Tooltip>
      ) : (
        <Text type="secondary">never</Text>
      ),
  },
];

/** The same row as a card on a phone. */
export function clientCard(row: ApiClientRow): RowCard {
  return {
    title: row.name,
    meta: `${row.client_id} · ${row.scopes.length} scopes`,
    pill: <StatusTag status={row.status} />,
    right: row.live_credentials === 0 ? "no live key" : `${row.live_credentials} of ${row.credential_count} keys`,
  };
}
