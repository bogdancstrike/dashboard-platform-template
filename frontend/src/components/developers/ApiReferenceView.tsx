/**
 * The API reference (§31): every mapped endpoint, grouped and searchable, each
 * with who may call it, its parameters, request snippets and — when one has been
 * captured — the real response and its inferred schema.
 */

import { Button, Card, Empty, Input, Tag, Tooltip, Typography } from "antd";
import { useMemo } from "react";

import type { ApiEndpoint, ApiReference } from "@/api/developers";
import { StatusTag } from "@/components/StatusTag";
import { relativeTime } from "@/lib/time";

import { CodeBlock } from "./CodeBlock";
import { METHOD_TONE, matches, sampleBody, snippet } from "./snippets";

const { Text, Paragraph } = Typography;

export function MethodTag({ method }: { method: string }) {
  return <StatusTag status={method} tone={(METHOD_TONE[method] ?? "neutral") as "acc"} label={method} />;
}

export function AccessTag({ endpoint }: { endpoint: Pick<ApiEndpoint, "access" | "permissions" | "allowed"> }) {
  if (endpoint.access === "public") return <Tag bordered={false} color="green">Public</Tag>;
  if (endpoint.access === "authenticated") return <Tag bordered={false}>Signed in</Tag>;
  if (endpoint.access === "unknown") return <Tag bordered={false}>Unknown guard</Tag>;
  return (
    <Tooltip title={endpoint.allowed ? "You hold this permission." : "You do not hold this permission."}>
      <Tag bordered={false} color={endpoint.allowed ? "blue" : "default"}>{endpoint.permissions.join(" + ")}</Tag>
    </Tooltip>
  );
}

export function ApiReferenceView({
  reference,
  query,
  onQuery,
  selected,
  onSelect,
  onTry,
}: {
  reference: ApiReference;
  query: string;
  onQuery: (query: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  onTry: (endpoint: ApiEndpoint) => void;
}) {
  const groups = useMemo(
    () => reference.groups
      .map((group) => ({ ...group, endpoints: group.endpoints.filter((endpoint) => !query || matches(endpoint, query)) }))
      .filter((group) => group.endpoints.length),
    [reference.groups, query],
  );
  const all = reference.groups.flatMap((group) => group.endpoints);
  const endpoint = all.find((item) => item.id === selected) ?? groups[0]?.endpoints[0] ?? null;

  return (
    <div className="nx-dev-reference">
      <Card size="small" className="nx-dev-index" data-testid="api-index"
        title={<Input.Search allowClear aria-label="Search endpoints" placeholder={`Search ${reference.total} endpoints`}
          value={query} onChange={(event) => onQuery(event.target.value)} />}>
        {groups.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No endpoint matches" /> : groups.map((group) => (
          <div key={group.key} className="nx-dev-group">
            <div className="nx-dev-group-label">{group.label} <span>{group.endpoints.length}</span></div>
            {group.endpoints.map((item) => (
              <button type="button" key={item.id} data-testid={`endpoint-${item.id}`}
                className={`nx-dev-endpoint${endpoint?.id === item.id ? " is-active" : ""}`} onClick={() => onSelect(item.id)}>
                <span className={`nx-dev-method nx-dev-method--${item.method.toLowerCase()}`}>{item.method}</span>
                <span className="nx-dev-endpoint-path">{item.route.replace(/^\/api/, "")}</span>
              </button>
            ))}
          </div>
        ))}
      </Card>

      {endpoint ? <EndpointDetail endpoint={endpoint} onTry={onTry} /> : <Card size="small"><Empty /></Card>}
    </div>
  );
}

function EndpointDetail({ endpoint, onTry }: { endpoint: ApiEndpoint; onTry: (endpoint: ApiEndpoint) => void }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const body = sampleBody(endpoint);
  const languages = (auth: "bearer" | "key") => ({
    curl: snippet("curl", { method: endpoint.method, path: endpoint.path, origin, body, auth }),
    JavaScript: snippet("javascript", { method: endpoint.method, path: endpoint.path, origin, body, auth }),
    Python: snippet("python", { method: endpoint.method, path: endpoint.path, origin, body, auth }),
  });
  return (
    <Card size="small" className="nx-dev-detail" data-testid="endpoint-detail">
      <div className="nx-dev-detail-head">
        <MethodTag method={endpoint.method} />
        <code className="nx-dev-path">{endpoint.path}</code>
        <Button type="primary" size="small" onClick={() => onTry(endpoint)} data-testid="try-endpoint">Try it</Button>
      </div>
      <h3 className="nx-dev-summary">{endpoint.summary}</h3>
      {endpoint.description && endpoint.description !== endpoint.summary && (
        <Paragraph type="secondary" className="nx-dev-doc">{endpoint.description}</Paragraph>
      )}
      <div className="nx-dev-facts">
        <span><Text type="secondary">Access</Text> <AccessTag endpoint={endpoint} /></span>
        <span><Text type="secondary">Operation</Text> <code>{endpoint.swagger?.operation_id ?? endpoint.operation}</code></span>
        {endpoint.example && <span><Text type="secondary">Example captured</Text> {endpoint.example.captured_at ? relativeTime(endpoint.example.captured_at) : "—"}</span>}
      </div>

      {endpoint.parameters.length > 0 && (
        <section className="nx-dev-section">
          <div className="nx-dev-label">Path parameters</div>
          <table className="nx-dev-table">
            <tbody>
              {endpoint.parameters.map((param) => (
                <tr key={param.name}><td><code>{param.name}</code></td><td>{param.type}</td><td>required</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="nx-dev-section">
        <div className="nx-dev-label">Request — with your session</div>
        <CodeBlock label="Request" languages={languages("bearer")} testId="request-snippet" />
        <div className="nx-dev-label">Request — with an API key</div>
        <CodeBlock label="Keyed request" languages={languages("key")} />
      </section>

      <section className="nx-dev-section">
        <div className="nx-dev-label">Response</div>
        {endpoint.example ? (
          <>
            <Text type="secondary" className="nx-dev-hint">
              {endpoint.example.status_code} from <code>{endpoint.example.path}</code>
              {endpoint.example.duration_ms !== null ? ` in ${endpoint.example.duration_ms} ms` : ""} — trimmed to a few items.
            </Text>
            <CodeBlock label="Response schema" code={JSON.stringify(endpoint.example.schema, null, 2)} testId="response-schema" />
            <CodeBlock label="Response example" code={JSON.stringify(endpoint.example.response, null, 2)} />
          </>
        ) : (
          <Text type="secondary" className="nx-dev-hint" data-testid="no-example">
            No response captured yet. Send it from the console and save it as the example — the schema is inferred from the real answer.
          </Text>
        )}
      </section>
    </Card>
  );
}
