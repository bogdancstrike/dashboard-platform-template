/**
 * The try-it console (§31): pick an endpoint, fill its parameters and body, send
 * it with your own session or an API client's key, and read the answer — status,
 * time, headers and body. A successful answer can be kept as the route's example.
 */

import { Alert, App as AntApp, Button, Card, Input, Segmented, Select, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";

import { accessToken } from "@/api/client";
import { developersApi, type ApiEndpoint, type ApiReference } from "@/api/developers";
import { CORRELATION_HEADER } from "@/config";

import { MethodTag } from "./ApiReferenceView";
import { CodeBlock } from "./CodeBlock";
import { fillPath, sampleBody } from "./snippets";

const { Text } = Typography;

export interface ConsoleResult {
  status: number;
  ok: boolean;
  ms: number;
  body: unknown;
  text: string;
  headers: Array<[string, string]>;
  path: string;
}

/** Send one request the way the console does. Exported for the tests. */
export async function send(input: { method: string; path: string; body?: string; auth: "session" | "key"; apiKey: string })
  : Promise<ConsoleResult> {
  const headers: Record<string, string> = { Accept: "application/json", [CORRELATION_HEADER]: crypto.randomUUID() };
  if (input.auth === "key") headers["X-Api-Key"] = input.apiKey;
  else {
    const token = await accessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const hasBody = Boolean(input.body?.trim()) && !["GET", "DELETE"].includes(input.method);
  if (hasBody) headers["Content-Type"] = "application/json";
  const started = performance.now();
  const response = await fetch(input.path, { method: input.method, headers, body: hasBody ? input.body : undefined });
  const text = await response.text();
  const ms = Math.round(performance.now() - started);
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON; shown as text */ }
  return { status: response.status, ok: response.ok, ms, body, text,
    headers: Array.from(response.headers.entries()), path: input.path };
}

export function ApiConsole({ reference, initial, onPick }: {
  reference: ApiReference;
  initial: string | null;
  onPick: (id: string) => void;
}) {
  const { message } = AntApp.useApp();
  const endpoints = useMemo(() => reference.groups.flatMap((group) => group.endpoints), [reference.groups]);
  const endpoint: ApiEndpoint | undefined =
    endpoints.find((item) => item.id === initial) ?? endpoints.find((item) => item.id === "GET /api/me") ?? endpoints[0];
  const [params, setParams] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [body, setBody] = useState("");
  const [auth, setAuth] = useState<"session" | "key">("session");
  const [apiKey, setApiKey] = useState("");
  const [result, setResult] = useState<ConsoleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setParams({});
    setResult(null);
    setError(null);
    setSaved(false);
    const sample = endpoint ? sampleBody(endpoint) : undefined;
    setBody(sample === undefined ? "" : JSON.stringify(sample, null, 2));
  }, [endpoint?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!endpoint) return null;
  const missing = endpoint.parameters.filter((param) => !params[param.name]?.trim()).map((param) => param.name);
  const path = fillPath(endpoint.path, params) + (query.trim() ? `?${query.trim().replace(/^\?/, "")}` : "");

  const run = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      if (body.trim() && endpoint.body) JSON.parse(body);
      setResult(await send({ method: endpoint.method, path, body: endpoint.body ? body : undefined, auth, apiKey }));
    } catch (failure) {
      setError(failure instanceof SyntaxError ? `The body is not valid JSON: ${failure.message}` : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const keep = async () => {
    if (!result) return;
    try {
      await developersApi.capture({ method: endpoint.method, route: endpoint.route, status_code: result.status, path: result.path,
        request_body: endpoint.body && body.trim() ? JSON.parse(body) : undefined, response: result.body, duration_ms: result.ms });
      setSaved(true);
      message.success("Kept as this endpoint's example");
    } catch (failure) {
      message.error(failure instanceof Error ? failure.message : "That could not be kept.");
    }
  };

  return (
    <div className="nx-dev-console">
      <Card size="small" className="nx-dev-request" data-testid="api-console" title="Request">
        <div className="nx-dev-field">
          <span className="nx-dev-label">Endpoint</span>
          <Select showSearch aria-label="Endpoint" value={endpoint.id} optionFilterProp="label" onChange={onPick}
            data-testid="console-endpoint"
            options={reference.groups.map((group) => ({ label: group.label, options: group.endpoints.map((item) => ({ value: item.id, label: `${item.method} ${item.route}` })) }))} />
        </div>
        <div className="nx-dev-line"><MethodTag method={endpoint.method} /><code className="nx-dev-path">{path}</code></div>
        {endpoint.parameters.map((param) => (
          <div className="nx-dev-field" key={param.name}>
            <span className="nx-dev-label">{param.name} <Text type="secondary">({param.type})</Text></span>
            <Input aria-label={param.name} value={params[param.name] ?? ""} placeholder={param.type === "uuid" ? "00000000-0000-0000-0000-000000000000" : ""}
              onChange={(event) => setParams({ ...params, [param.name]: event.target.value })} />
          </div>
        ))}
        <div className="nx-dev-field">
          <span className="nx-dev-label">Query string</span>
          <Input aria-label="Query string" value={query} placeholder="page=1&page_size=5" onChange={(event) => setQuery(event.target.value)} />
        </div>
        {endpoint.body && (
          <div className="nx-dev-field">
            <span className="nx-dev-label">Body (JSON)</span>
            <Input.TextArea aria-label="Body" className="nx-dev-mono" autoSize={{ minRows: 4, maxRows: 14 }} value={body} onChange={(event) => setBody(event.target.value)} />
          </div>
        )}
        <div className="nx-dev-field">
          <span className="nx-dev-label">Send as</span>
          <Segmented aria-label="Send as" value={auth} onChange={(value) => setAuth(value as "session" | "key")}
            options={[{ value: "session", label: "My session" }, { value: "key", label: "An API key" }]} />
          {auth === "key" && (
            <Input.Password aria-label="API key" placeholder="nuc_…" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" />
          )}
        </div>
        {endpoint.method !== "GET" && (
          <Alert type="warning" showIcon message="This request changes data for real." className="nx-dev-warning" />
        )}
        <Button type="primary" onClick={() => void run()} loading={busy} disabled={missing.length > 0 || (auth === "key" && !apiKey)} data-testid="console-send">
          {missing.length ? `Fill in ${missing.join(", ")}` : "Send"}
        </Button>
      </Card>

      <Card size="small" className="nx-dev-response" title="Response" data-testid="console-response"
        extra={result && <span className="nx-dev-status">
          <Tag bordered={false} color={result.ok ? "success" : result.status >= 500 ? "error" : "warning"} data-testid="console-status">{result.status}</Tag>
          <Text type="secondary" data-testid="console-time">{result.ms} ms</Text>
        </span>}>
        {error && <Alert type="error" showIcon message={error} />}
        {!result && !error && <Text type="secondary">Send the request to see the answer here.</Text>}
        {result && (
          <>
            <CodeBlock label="Response body" code={typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2)} testId="console-body" />
            <details className="nx-dev-headers">
              <summary>{result.headers.length} response headers</summary>
              <table className="nx-dev-table"><tbody>{result.headers.map(([name, value]) => <tr key={name}><td><code>{name}</code></td><td>{value}</td></tr>)}</tbody></table>
            </details>
            {reference.can_capture && result.ok && (
              <Button onClick={() => void keep()} disabled={saved} data-testid="console-keep">{saved ? "Kept as the example" : "Keep as this endpoint's example"}</Button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
