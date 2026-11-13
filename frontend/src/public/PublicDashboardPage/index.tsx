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

import { Result, Skeleton } from "antd";

import { EmptyState } from "@/components/EmptyState";
import { absoluteTime } from "@/lib/time";

import { LockForm } from "./LockForm";
import { WidgetData } from "./WidgetData";
import { usePublicDashboard } from "./usePublicDashboard";

export { embeddingOrigin } from "./access";

export function PublicDashboardPage({ token }: { token: string }) {
  const { state, password, setPassword, unlocking, unlock } = usePublicDashboard(token);

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
        <LockForm
          name={state.name}
          error={state.error}
          password={password}
          setPassword={setPassword}
          unlocking={unlocking}
          onUnlock={() => void unlock()}
        />
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

function Footer() {
  return <p className="nx-ra-public-foot">Shared with Nucleus · read-only view</p>;
}
