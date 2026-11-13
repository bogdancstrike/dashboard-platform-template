import { Alert, Card, Descriptions, Space, Statistic, Tag, Typography } from "antd";

import type { ApiClientDetail } from "@/api/apiClients";
import { formatNumber } from "@/lib/formats";
import { relativeTime } from "@/lib/time";

import { ClientKeys } from "./ClientKeys";

const { Text } = Typography;

/** One client: its keys, its limits, and the requests it has recently made. */
export function ClientDetail({
  client,
  grace,
  busy,
  onRotate,
  onRevoke,
}: {
  client: ApiClientDetail;
  grace: number;
  busy: boolean;
  onRotate: (credentialId?: string) => void;
  onRevoke: (credentialId: string) => void;
}) {
  return (
    <Space direction="vertical" size={16} className="nu-block">
      {client.live_credentials === 0 && (
        <Alert
          type="warning"
          showIcon
          data-testid="no-live-keys"
          message="This client cannot call anything"
          description="Every key it holds is revoked or expired. Add one to bring it back."
        />
      )}

      <ClientNumbers client={client} />

      <section data-testid="client-scopes">
        <Text strong>What it may do</Text>
        <div className="nu-block">
          {client.scopes.length === 0 ? (
            <Text type="secondary">
              Nothing. It can authenticate and read nothing — which is a valid state for a
              client that has not been given its scopes yet.
            </Text>
          ) : (
            <Space size={[4, 4]} wrap>
              {client.scopes.map((scope) => (
                <Tag key={scope} bordered={false} className="nu-mono">
                  {scope}
                </Tag>
              ))}
            </Space>
          )}
        </div>
      </section>

      <ClientKeys client={client} grace={grace} busy={busy} onRotate={onRotate} onRevoke={onRevoke} />

      <ClientRequests client={client} />
    </Space>
  );
}

function ClientNumbers({ client }: { client: ApiClientDetail }) {
  return (
    <Card size="small" data-testid="client-numbers">
      <div className="nu-api-stats">
        {/* Two windows, labelled — see the module docstring. */}
        <Statistic
          title="Requests (lifetime)"
          value={client.requests_total}
          formatter={(value) => formatNumber(Number(value))}
        />
        <Statistic title="Today" value={client.requests_today} formatter={(v) => formatNumber(Number(v))} />
        <Statistic
          title="Errors (lifetime)"
          value={`${(client.error_rate * 100).toFixed(1)}%`}
        />
        <Statistic
          title="In the log below"
          value={`${client.recent_failures} of ${client.recent_window} failed`}
        />
      </div>
      <Descriptions
        size="small"
        column={2}
        className="nu-block"
        items={[
          { key: "id", label: "Client ID", children: <Text copyable className="nu-mono">{client.client_id}</Text> },
          { key: "rate", label: "Rate limit", children: `${formatNumber(client.rate_limit_per_minute)}/min` },
          { key: "quota", label: "Daily quota", children: formatNumber(client.quota_per_day) },
          {
            key: "ips",
            label: "From",
            children: client.allowed_ips.length > 0 ? client.allowed_ips.join(", ") : "anywhere",
          },
        ]}
      />
    </Card>
  );
}

/** The last few requests, labelled as such rather than as the lifetime total. */
function ClientRequests({ client }: { client: ApiClientDetail }) {
  return (
    <section data-testid="client-requests">
      <Text strong>
        Recent requests{" "}
        <Text type="secondary">(the last {client.recent_window}, not the lifetime total)</Text>
      </Text>
      {client.recent_requests.length === 0 ? (
        <p>
          <Text type="secondary">Nothing logged for this client yet.</Text>
        </p>
      ) : (
        <ul className="nu-api-requests">
          {client.recent_requests.map((request) => (
            <li key={request.id}>
              <Text
                type={request.status_code >= 400 ? "danger" : "secondary"}
                className="nu-api-request-status"
              >
                {request.status_code}
              </Text>
              <Text className="nu-api-request-path">
                {request.method} {request.path}
              </Text>
              <Text type="secondary" className="nu-api-request-when">
                {request.requested_at ? relativeTime(request.requested_at) : "—"}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
