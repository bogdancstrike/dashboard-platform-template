/**
 * A dashboard shared by link (§25): `/share/dashboards/<token>`, outside the
 * signed-in application — no navigation, no session. Glass panels on the
 * product's ground, every widget already answered by the server.
 *
 * A password-protected link asks for the password first and keeps the grant
 * it is exchanged for in this tab only. Embedded in an iframe, the page tells
 * the server which origin framed it, and the server refuses origins the owner
 * did not allow.
 */
import "@/styles/records-analytics.css";

import { Button, Input, Result, Skeleton, Table } from "antd";
import { useCallback, useEffect, useState } from "react";

import { panelFor } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import { ApiError } from "@/api/client";
import { publicApi, type PublicDashboard, type PublicWidgetData } from "@/api/recordsAnalytics";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { NxLogo } from "@/components/NxIcon";
import { StatusTag } from "@/components/StatusTag";
import { formatMetric } from "@/entities/EntityChrome";
import { asText } from "@/lib/text";
import { absoluteTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";

const GRANT_KEY = (token: string) => `nucleus.share.${token}`;

function storedGrant(token: string): string | null {
  try {
    return sessionStorage.getItem(GRANT_KEY(token));
  } catch {
    return null;
  }
}

/** The origin of the page framing this one, when it is framed. */
export function embeddingOrigin(): string | null {
  if (window.self === window.top) return null;
  const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (ancestors && ancestors.length) return ancestors[0]!;
  try {
    return document.referrer ? new URL(document.referrer).origin : "unknown";
  } catch {
    return "unknown";
  }
}

type State =
  | { kind: "loading" }
  | { kind: "locked"; name: string; error?: string }
  | { kind: "ready"; data: PublicDashboard }
  | { kind: "gone"; title: string; detail: string };

export function PublicDashboardPage({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const load = useCallback(
    async (grant: string | null) => {
      try {
        const data = await publicApi.view(token, grant, embeddingOrigin());
        setState({ kind: "ready", data });
        document.title = `${data.dashboard.name} · Nucleus`;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401 && error.details["reason"] === "password_required") {
          const meta = await publicApi.meta(token).catch(() => ({ name: "Shared dashboard" }));
          setState({ kind: "locked", name: meta.name });
        } else {
          setState(failure(error));
        }
      }
    },
    [token],
  );

  useEffect(() => {
    void load(storedGrant(token));
  }, [load, token]);

  const unlock = async () => {
    setUnlocking(true);
    try {
      const result = await publicApi.unlock(token, password);
      if (result.grant) {
        try {
          sessionStorage.setItem(GRANT_KEY(token), result.grant);
        } catch {
          /* a private window: the grant lives for this load only */
        }
      }
      await load(result.grant);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState((current) => (current.kind === "locked" ? { ...current, error: "That password is not right." } : current));
      } else {
        setState(failure(error));
      }
    } finally {
      setUnlocking(false);
    }
  };

  if (state.kind === "loading") {
    return <main className="nx-ra-public"><Skeleton active paragraph={{ rows: 10 }} /></main>;
  }
  if (state.kind === "gone") {
    return (
      <main className="nx-ra-public">
        <Result status="warning" title={state.title} subTitle={state.detail} />
        <Footer />
      </main>
    );
  }
  if (state.kind === "locked") {
    return (
      <main className="nx-ra-public">
        <form
          className="nx-ra-panel nx-ra-public-lock"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
          data-testid="public-lock"
        >
          <NxLogo />
          <h1>{state.name}</h1>
          <p className="nx-ra-sub">This dashboard is protected. Enter the password you were given.</p>
          <Input.Password
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            aria-label="Password"
            status={state.error ? "error" : undefined}
            data-testid="public-password"
          />
          {state.error && <p className="nx-ra-sub" style={{ color: "var(--nu-bad)", margin: "8px 0 0" }} role="alert">{state.error}</p>}
          <Button type="primary" htmlType="submit" block loading={unlocking} disabled={!password} style={{ marginTop: 12 }} data-testid="public-unlock">
            Open dashboard
          </Button>
        </form>
        <Footer />
      </main>
    );
  }

  const { data } = state;
  return (
    <main className="nx-ra-public" data-testid="public-dashboard">
      <header className="nx-ra-public-head">
        <div>
          <h1>{data.dashboard.name}</h1>
          <p>
            {data.dashboard.description ? `${data.dashboard.description} · ` : ""}
            Shared by {data.dashboard.owner ?? "a Nucleus user"} · data as of {absoluteTime(data.generated_at)}
            {data.link.expires_at ? ` · link valid until ${absoluteTime(data.link.expires_at)}` : ""}
          </p>
        </div>
        <span className="nx-ra-pill">Read-only</span>
      </header>
      {data.widgets.length === 0 ? (
        <EmptyState title="This dashboard has no widgets yet" />
      ) : (
        <div className="nx-ra-public-grid">
          {data.widgets.map((widget) => (
            <section
              key={widget.id}
              className="nx-ra-panel"
              style={{ ["--w" as string]: Math.max(2, Math.min(12, widget.width)), ["--h" as string]: Math.max(2, widget.height) }}
              aria-label={widget.title}
            >
              <h2>{widget.title}</h2>
              <div className="nx-ra-public-body"><WidgetData data={widget.data} kind={widget.kind} /></div>
            </section>
          ))}
        </div>
      )}
      <Footer />
    </main>
  );
}

function failure(error: unknown): State {
  if (error instanceof ApiError) {
    const raw = error.details["reason"];
    const reason = typeof raw === "string" ? raw : "";
    if (error.status === 404) return { kind: "gone", title: "This link does not exist", detail: "Check the address, or ask the person who shared it for a new one." };
    if (error.status === 410 && reason === "expired") return { kind: "gone", title: "This link has expired", detail: "Ask the person who shared it for a new link." };
    if (error.status === 410) return { kind: "gone", title: "This link is no longer available", detail: error.message };
    if (error.status === 403) return { kind: "gone", title: "This dashboard cannot be shown here", detail: "Its owner has not allowed it to be embedded on this site." };
    if (error.status === 429) return { kind: "gone", title: "Too many requests", detail: "Wait a minute and reload the page." };
  }
  return { kind: "gone", title: "Could not load this dashboard", detail: error instanceof Error ? error.message : "Try again later." };
}

function Footer() {
  return <p className="nx-ra-public-foot">Shared with Nucleus · read-only view</p>;
}

function WidgetData({ data, kind }: { data: PublicWidgetData; kind: string }) {
  switch (data.type) {
    case "metrics": {
      if (data.strip) {
        return (
          <div className="nx-ra-strip">
            {data.metrics.map((metric) => {
              const shown = formatMetric(metric as never);
              return <div key={metric.key}><b>{shown.value}{shown.unit}</b><span>{metric.label}</span></div>;
            })}
          </div>
        );
      }
      const metric = data.metrics.find((m) => m.key === data.metric) ?? (data.gauge ? data.metrics.find((m) => m.format === "percent") : undefined) ?? data.metrics[0];
      if (!metric) return <EmptyState compact title="No metric" />;
      if (data.gauge) {
        return <ChartPreview panel={{ kind: "gauge", title: metric.label, series: [{ name: metric.label, value: Number(metric.value ?? 0) }] }} height={140} />;
      }
      const shown = formatMetric(metric as never);
      return <div className="nx-ra-metric"><b>{shown.value}{shown.unit}</b><span>{metric.label}</span></div>;
    }
    case "chart": {
      if (!data.result.rows.length) return <EmptyState compact title="Nothing in this period" />;
      return <ChartPreview panel={panelFor(data.result, (data.chart || "bar") as ChartKind)} height={kind === "REPORT" ? 200 : 170} />;
    }
    case "rows":
      if (!data.items.length) return <EmptyState compact title="Nothing here yet" />;
      if (!data.table) {
        return (
          <ul className="nx-ra-rows">
            {data.items.map((row) => (
              <li key={asText(row.id)} className="nx-ra-row" style={{ cursor: "default" }}>
                <div className="nx-ra-row-main"><b>{asText(row[data.title_field]) || asText(row.id)}</b></div>
                {data.status_field && row[data.status_field] ? <StatusTag status={asText(row[data.status_field])} /> : null}
              </li>
            ))}
          </ul>
        );
      }
      return (
        <Table
          size="small"
          rowKey={(row) => asText(row.id)}
          pagination={false}
          dataSource={data.items}
          columns={data.columns.map((column) => ({
            title: column.label,
            dataIndex: column.name,
            ellipsis: true,
            render: (value: unknown) => (column.name === data.status_field ? <StatusTag status={asText(value)} /> : asText(value) || "—"),
          }))}
        />
      );
    case "private":
      return <p className="nx-ra-muted">{data.message}</p>;
    case "empty":
      return <p className="nx-ra-muted">{data.message}</p>;
    default:
      return <p className="nx-ra-muted">This widget could not be drawn: {data.message}</p>;
  }
}
