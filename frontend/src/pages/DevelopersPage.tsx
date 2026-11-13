/**
 * `/developers` — the developer portal (§31).
 *
 * One page with six places, each its own address so back and a pasted link both
 * work: the API reference (read from the endpoint map, the handlers' own guards
 * and Swagger), the try-it console, usage per API client, webhooks, SDK snippets
 * and the changelog. The UI component documentation already lives at
 * `/showcase/components` with live demos and copy-code, so it is linked, not
 * copied.
 */

import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Segmented, Skeleton, Typography } from "antd";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { developersApi, type ApiReference } from "@/api/developers";
import { useAuth } from "@/auth/AuthProvider";
import { usePageCommands } from "@/commands/CommandContext";
import { ApiConsole } from "@/components/developers/ApiConsole";
import { ApiReferenceView } from "@/components/developers/ApiReferenceView";
import { ApiUsageView } from "@/components/developers/ApiUsageView";
import { CodeBlock } from "@/components/developers/CodeBlock";
import { SDK_CLIENTS } from "@/components/developers/snippets";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import "@/styles/developers.css";
import { STALE, queryKeys } from "@/lib/queryKeys";

const { Paragraph, Text } = Typography;

export const DEVELOPER_TABS = [
  { key: "reference", label: "API reference" },
  { key: "console", label: "Try it" },
  { key: "usage", label: "Usage", permission: "api.manage" },
  { key: "webhooks", label: "Webhooks" },
  { key: "sdks", label: "SDKs" },
  { key: "changelog", label: "Changelog" },
] as const;

export default function DevelopersPage() {
  const { tab = "reference" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const reference = useQuery({
    queryKey: queryKeys.developerReference(),
    queryFn: ({ signal }) => developersApi.reference(signal),
    staleTime: STALE.long,
  });

  const tabs = DEVELOPER_TABS.filter((item) => !("permission" in item) || can(item.permission));
  const current = tabs.some((item) => item.key === tab) ? tab : "reference";
  const go = (key: string, search = "") => navigate(`/developers${key === "reference" ? "" : `/${key}`}${search}`);
  // Filters replace; the endpoint is a place and pushes.
  const setParam = (key: string, value: string, push = false) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: !push });
  };

  usePageCommands("developers", [
    { id: "developers.console", label: "Try an API call", keywords: "api console request curl", run: () => go("console") },
    { id: "developers.reference", label: "Open the API reference", keywords: "api docs endpoints swagger", run: () => go("reference") },
  ]);

  return (
    <>
      <PageHeader
        title={<>Developer <em>portal</em></>}
        subtitle={reference.data ? `${reference.data.total} endpoints · ${reference.data.documented} with a captured example · every one read from the platform itself` : "The API, explained — read from the platform itself."}
        actions={
          <>
            <Button href="/swagger.json" target="_blank" rel="noreferrer" icon={<NxIcon name="code" size={16} />}>swagger.json</Button>
            <Link to="/showcase/components"><Button icon={<NxIcon name="grid" size={16} />} data-testid="components-link">UI components</Button></Link>
          </>
        }
      />
      <div className="nx-dev-tabs">
        <Segmented aria-label="Developer portal section" value={current} onChange={(value) => go(String(value))} data-testid="developer-tabs"
          options={tabs.map((item) => ({ value: item.key, label: item.label }))} />
      </div>

      {reference.isError ? (
        <Alert type="error" showIcon message={reference.error instanceof ApiError ? reference.error.message : "The reference could not be loaded."}
          action={<Button onClick={() => void reference.refetch()}>Retry</Button>} />
      ) : !reference.data ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : current === "reference" ? (
        <ApiReferenceView reference={reference.data} query={params.get("q") ?? ""} onQuery={(q) => setParam("q", q)}
          selected={params.get("endpoint")} onSelect={(id) => setParam("endpoint", id, true)}
          onTry={(endpoint) => go("console", `?endpoint=${encodeURIComponent(endpoint.id)}`)} />
      ) : current === "console" ? (
        <ApiConsole reference={reference.data} initial={params.get("endpoint")} onPick={(id) => setParam("endpoint", id)} />
      ) : current === "usage" ? (
        <ApiUsageView client={params.get("client") ?? ""} days={Number(params.get("days") ?? 14)}
          onClient={(id) => setParam("client", id)} onDays={(days) => setParam("days", days === 14 ? "" : String(days))} />
      ) : current === "webhooks" ? (
        <Webhooks reference={reference.data} />
      ) : current === "sdks" ? (
        <Sdks reference={reference.data} />
      ) : (
        <Changelog reference={reference.data} />
      )}
    </>
  );
}

function Webhooks({ reference }: { reference: ApiReference }) {
  const origin = window.location.origin;
  return (
    <div className="nx-dev-docs" data-testid="webhooks-doc">
      <Card size="small" title="Into Nucleus: start a workflow">
        <Paragraph>
          A workflow whose trigger is <b>Webhook called</b> gets its own address when it is published. POST the id of a record in the
          workflow's dataset and the workflow runs for it. The unguessable token in the address is the credential; the address survives
          later edits and publishes. Find it on the workflow's canvas.
        </Paragraph>
        <CodeBlock label="Trigger" code={`curl -X POST "${origin}${reference.base_path}/public/automations/hooks/<token>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"record_id": "<uuid of the record>"}'\n\n# 202 {"accepted": true, "run_id": "…", "fired": 1}`} />
        <Paragraph type="secondary">404 when no published workflow listens there, 400 when it is paused or the record id is not one of its dataset's.</Paragraph>
        <Link to="/workflows"><Button>Open workflows</Button></Link>
      </Card>
      <Card size="small" title="Out of Nucleus: the Call a webhook action">
        <Paragraph>
          A workflow step <b>Call a webhook</b> POSTs this body to the address you configure — one attempt, a five-second timeout, redirects
          not followed. The run history on the workflow records the HTTP status of every call.
        </Paragraph>
        <CodeBlock label="Payload" code={JSON.stringify({
          rule: { id: "6f1c…", name: "Route urgent tickets to the on-call lead", severity: "CRITICAL" },
          resource_type: "ticket",
          record: { id: "0b7e…", label: "TCK-03318", path: "/tickets/0b7e…" },
          at: "2026-11-13T04:12:09+00:00",
        }, null, 2)} />
        <Paragraph type="secondary">Headers: <code>Content-Type: application/json</code>, <code>User-Agent: Nucleus-Automation/1</code>.</Paragraph>
      </Card>
    </div>
  );
}

function Sdks({ reference }: { reference: ApiReference }) {
  return (
    <div className="nx-dev-docs" data-testid="sdks-doc">
      <Card size="small" title="Authenticating">
        <Paragraph><Text strong>A person</Text> — <code>{reference.auth.bearer}</code>. The browser app does exactly this.</Paragraph>
        <Paragraph><Text strong>A machine</Text> — <code>{reference.auth.api_key}</code>. Create a client under{" "}
          <Link to="/admin/api">Administration → API clients</Link>; the key acts as the client's owner, limited to the client's scopes,
          its allowed addresses and its per-minute limit, and every call shows up under Usage.</Paragraph>
      </Card>
      <Card size="small" title="A minimal client">
        <CodeBlock label="SDK" languages={{ JavaScript: SDK_CLIENTS.javascript, Python: SDK_CLIENTS.python }} testId="sdk-snippet" />
      </Card>
    </div>
  );
}

function Changelog({ reference }: { reference: ApiReference }) {
  return (
    <div className="nx-dev-docs" data-testid="changelog">
      {reference.changelog.map((entry) => (
        <Card size="small" key={entry.version} title={<span className="nx-dev-release"><span className="nx-dev-version">v{entry.version}</span>{entry.title}</span>}
          extra={<Text type="secondary">{entry.date}</Text>}>
          <ul className="nx-dev-list">{entry.items.map((item) => <li key={item}>{renderTicks(item)}</li>)}</ul>
        </Card>
      ))}
    </div>
  );
}

/** `code` in backticks, as the changelog writes it. */
export function renderTicks(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : <span key={index}>{part}</span>,
  );
}
