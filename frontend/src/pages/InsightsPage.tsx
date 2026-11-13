import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Alert, App as AntApp, Button, Dropdown, Input, Popconfirm, Segmented, Skeleton, Tooltip, Typography } from "antd";
import {
  AppstoreAddOutlined,
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  LockOutlined,
  PushpinFilled,
  PushpinOutlined,
  TeamOutlined,
} from "@ant-design/icons";

import { ApiError } from "@/api/client";
import { insightsApi, type InsightDraft, type InsightSummary, type SavedInsight } from "@/api/insights";
import { useSmartBack } from "@/app/history";
import { usePageCommands } from "@/commands/CommandContext";
import { AddToDashboard, type DashboardSubject } from "@/components/dashboards/AddToDashboard";
import { EmptyState } from "@/components/EmptyState";
import { NameModal } from "@/components/NameModal";
import { PageHeader } from "@/components/PageHeader";
import { InsightView } from "@/components/insights/InsightView";
import { KnIcon } from "@/components/knowledge/KnIcon";
import { relativeTime } from "@/lib/time";
import "@/styles/insights.css";
import "@/styles/knowledge.css";
import { FEATURES, useFeature } from "@/settings/features";

const { Text } = Typography;

const SCOPE = {
  PRIVATE: { label: "Only me", icon: <LockOutlined /> },
  SHARED: { label: "Shared", icon: <TeamOutlined /> },
  PUBLIC: { label: "Everyone", icon: <GlobalOutlined /> },
} as const;

const SOURCE: Record<string, string> = { ai: "Built by AI", suggested: "Suggested", fallback: "Composed without AI" };

/**
 * Insights (§43): ask a question about the records, get a page built from a
 * fixed set of components with the numbers bound in.
 *
 * The address carries what is open: `?insight=<id>` for a saved one (pushed),
 * `?draft=1` while a fresh answer is on screen (pushed, so back returns to the
 * gallery). A draft lives in memory until it is saved.
 */
export default function InsightsPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const back = useSmartBack();
  const [params, setParams] = useSearchParams();
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState<InsightDraft | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [dashboardFor, setDashboardFor] = useState<DashboardSubject | null>(null);
  const [filter, setFilter] = useState<"all" | "mine">("all");

  const openId = params.get("insight");
  const showingDraft = params.get("draft") === "1" && draft !== null;

  const list = useQuery({ queryKey: ["insights"], queryFn: ({ signal }) => insightsApi.list({}, signal) });
  const saved = useQuery({
    queryKey: ["insight", openId],
    queryFn: ({ signal }) => insightsApi.get(openId!, false, signal),
    enabled: Boolean(openId),
  });

  function openDraft(next: InsightDraft) {
    setDraft(next);
    const search = new URLSearchParams();
    search.set("draft", "1");
    setParams(search);
  }
  function openSaved(id: string) {
    setParams(new URLSearchParams({ insight: id }));
  }

  const failed = (error: Error) => {
    const unavailable = error instanceof ApiError && [429, 503, 504].includes(error.status);
    setFailure(unavailable ? "The AI model is not available right now. Try again in a moment, or pick a suggestion — those need no model." : error.message);
  };
  const generate = useMutation({
    mutationFn: (text: string) => insightsApi.generate(text),
    onMutate: () => setFailure(null),
    onSuccess: openDraft,
    onError: failed,
  });
  const suggest = useMutation({
    mutationFn: (key: string) => insightsApi.suggestion(key),
    onMutate: () => setFailure(null),
    onSuccess: (result) => {
      setQuestion(result.question);
      openDraft(result);
    },
    onError: failed,
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["insights"] });
  const save = useMutation({
    mutationFn: (current: InsightDraft) => insightsApi.save(current),
    onSuccess: (result) => {
      message.success("Insight saved");
      invalidate();
      queryClient.setQueryData(["insight", result.id], result);
      setDraft(null);
      setParams(new URLSearchParams({ insight: result.id }), { replace: true });
    },
    onError: (error: Error) => message.error(error.message),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof insightsApi.update>[1] }) =>
      insightsApi.update(id, input),
    onSuccess: (result) => {
      queryClient.setQueryData(["insight", result.id], result);
      invalidate();
    },
    onError: (error: Error) => message.error(error.message),
  });
  const refresh = useMutation({
    mutationFn: (id: string) => insightsApi.refresh(id),
    onSuccess: (result) => {
      queryClient.setQueryData(["insight", result.id], result);
      message.success("Numbers re-read");
      invalidate();
    },
    onError: (error: Error) => message.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => insightsApi.remove(id),
    onSuccess: () => {
      message.success("Insight removed");
      invalidate();
      setParams(new URLSearchParams(), { replace: true });
    },
    onError: (error: Error) => message.error(error.message),
  });

  usePageCommands("insights", [
    {
      id: "insights-ask",
      label: "Ask a question about your data",
      keywords: "insight ai chart generate",
      run: () => document.querySelector<HTMLInputElement>("[data-testid=insight-question]")?.focus(),
    },
  ]);

  const items = useMemo(() => {
    const all = list.data?.items ?? [];
    return filter === "mine" ? all.filter((item) => item.can_edit) : all;
  }, [list.data, filter]);
  const busy = generate.isPending || suggest.isPending;
  const current: SavedInsight | InsightDraft | null = openId ? (saved.data ?? null) : showingDraft ? draft : null;

  function ask(text = question) {
    const trimmed = text.trim();
    if (trimmed && !busy) generate.mutate(trimmed);
  }

  return (
    <div className="nu-page nx-in" data-testid="insights-page">
      <PageHeader
        title={
          <>
            Data <em>insights</em>
          </>
        }
        subtitle="Ask a question about your records — get a page of numbers and charts built from them, refreshed whenever you like."
        onBack={current ? () => back("/ai/insights") : undefined}
      />

      <div className="nx-in-ask nx-glass" data-testid="insight-ask">
        <form
          className="nx-in-ask-row"
          onSubmit={(event) => {
            event.preventDefault();
            ask();
          }}
        >
          <span className="nx-in-ask-mark">
            <KnIcon name="insights" size={18} />
          </span>
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="e.g. Which channels bring the most revenue, and is it growing?"
            maxLength={500}
            variant="borderless"
            data-testid="insight-question"
            aria-label="Your question about the data"
          />
          <Button type="primary" htmlType="submit" loading={generate.isPending} disabled={!question.trim()} data-testid="insight-generate">
            Build insight
          </Button>
        </form>
        <div className="nx-in-chips" data-testid="insight-suggestions" hidden={Boolean(current) || busy}>
          {(list.data?.suggestions ?? []).map((item) => (
            <button
              key={item.key}
              type="button"
              className="nx-in-chip"
              disabled={busy}
              onClick={() => suggest.mutate(item.key)}
              title={item.question}
            >
              <span className="nx-in-chip-tag">{item.dataset_label}</span>
              {item.question}
            </button>
          ))}
        </div>
      </div>

      {failure && (
        <Alert
          type="warning"
          showIcon
          className="nu-block"
          message={failure}
          data-testid="insight-failure"
          action={
            question.trim() ? (
              <Button onClick={() => ask()}>
                Try again
              </Button>
            ) : undefined
          }
        />
      )}

      {busy && (
        <div className="nx-in-panel nx-glass" data-testid="insight-building">
          <Text type="secondary">
            <span className="nx-kn-dots">
              <i />
              <i />
              <i />
            </span>{" "}
            {generate.isPending ? "Looking at your data and laying out the page…" : "Reading the numbers…"}
          </Text>
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      )}

      {!busy && current && (
        <article className="nx-in-panel nx-glass" data-testid="insight-panel">
          <header className="nx-in-head">
            <div className="nx-in-head-text">
              <h2 className="nx-in-head-title" data-testid="insight-title">
                {current.title}
              </h2>
              <Text type="secondary" className="nx-in-head-question">
                “{current.question}”
              </Text>
              <Text type="secondary" className="nx-in-head-meta">
                {[
                  SOURCE[current.source],
                  current.model,
                  current.refreshed_at ? `numbers from ${relativeTime(current.refreshed_at)}` : null,
                  "id" in current && current.id && "owner" in current ? `by ${current.owner.name}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </div>
            <div className="nx-in-actions">
              {current.id === null ? (
                <>
                  <Button onClick={() => back("/ai/insights")}>Discard</Button>
                  <Button type="primary" loading={save.isPending} onClick={() => save.mutate(current as InsightDraft)} data-testid="insight-save">
                    Save insight
                  </Button>
                </>
              ) : (
                <SavedActions
                  insight={current as SavedInsight}
                  refreshing={refresh.isPending}
                  onRefresh={() => refresh.mutate(current.id!)}
                  onPin={(pinned) => update.mutate({ id: current.id!, input: { pinned } })}
                  onScope={(scope) => update.mutate({ id: current.id!, input: { scope } })}
                  onRename={() => setRenaming(true)}
                  onDashboard={() => setDashboardFor({ kind: "INSIGHT", id: current.id!, title: current.title })}
                  onRemove={() => remove.mutate(current.id!)}
                  canShare={list.data?.can_share ?? false}
                />
              )}
            </div>
          </header>
          {current.summary && <p className="nx-in-summary">{current.summary}</p>}
          {current.warnings.length > 0 && (
            <Alert
              type="info"
              className="nx-in-warnings"
              message={`${current.warnings.length} note${current.warnings.length === 1 ? "" : "s"} about this page`}
              description={
                <ul>
                  {current.warnings.slice(0, 6).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              }
              data-testid="insight-warnings"
            />
          )}
          <InsightView blocks={current.rendered?.blocks ?? []} />
        </article>
      )}

      {!busy && openId && saved.isError && (
        <EmptyState title="That insight is not available" hint="It was removed, or it is no longer shared with you." />
      )}
      {!busy && openId && saved.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}

      {!busy && !current && !openId && (
        <section className="nx-in-gallery" data-testid="insight-gallery">
          <div className="nx-in-gallery-bar">
            <h2 className="nx-in-gallery-title">Saved insights</h2>
            <Segmented
              value={filter}
              onChange={(value) => setFilter(value as "all" | "mine")}
              options={[
                { value: "all", label: "All I can see" },
                { value: "mine", label: "Mine" },
              ]}
            />
          </div>
          {list.isLoading && <Skeleton active />}
          {!list.isLoading && !items.length && (
            <EmptyState
              title="No saved insights yet"
              hint="Ask a question above, or press a suggestion — then save the page you want to keep."
            />
          )}
          <div className="nx-in-cards">
            {items.map((item) => (
              <InsightCard key={item.id} item={item} onOpen={() => openSaved(item.id)} />
            ))}
          </div>
        </section>
      )}

      <NameModal
        open={renaming}
        title="Rename insight"
        label="Insight name"
        okText="Rename"
        initial={current?.title ?? ""}
        onClose={() => setRenaming(false)}
        onSubmit={(title) => {
          setRenaming(false);
          if (current?.id) update.mutate({ id: current.id, input: { title } });
        }}
      />
      <AddToDashboard open={dashboardFor !== null} subject={dashboardFor} onClose={() => setDashboardFor(null)} />
    </div>
  );
}

function SavedActions({
  insight,
  refreshing,
  canShare,
  onRefresh,
  onPin,
  onScope,
  onRename,
  onDashboard,
  onRemove,
}: {
  insight: SavedInsight;
  refreshing: boolean;
  canShare: boolean;
  onRefresh: () => void;
  onPin: (pinned: boolean) => void;
  onScope: (scope: "PRIVATE" | "PUBLIC") => void;
  onRename: () => void;
  onDashboard: () => void;
  onRemove: () => void;
}) {
  const dashboardsOn = useFeature(FEATURES.dashboardBuilder);
  return (
    <>
      <Tooltip title="Re-run its queries for today's numbers — the AI is not asked again">
        <Button icon={<KnIcon name="refresh" />} loading={refreshing} onClick={onRefresh} data-testid="insight-refresh">
          Refresh
        </Button>
      </Tooltip>
      {dashboardsOn && (
        <Button icon={<AppstoreAddOutlined />} onClick={onDashboard} data-testid="insight-dashboard">
          Add to dashboard
        </Button>
      )}
      {insight.can_edit && (
        <>
          <Tooltip title={insight.pinned ? "Unpin" : "Pin to the top"}>
            <Button
              shape="circle"
              aria-label={insight.pinned ? "Unpin" : "Pin"}
              icon={insight.pinned ? <PushpinFilled /> : <PushpinOutlined />}
              onClick={() => onPin(!insight.pinned)}
              data-testid="insight-pin"
            />
          </Tooltip>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "rename", label: "Rename", icon: <EditOutlined /> },
                ...(canShare
                  ? [
                      insight.scope === "PUBLIC"
                        ? { key: "private", label: "Make private", icon: <LockOutlined /> }
                        : { key: "public", label: "Share with everyone", icon: <GlobalOutlined /> },
                    ]
                  : []),
              ],
              onClick: ({ key }) => {
                if (key === "rename") onRename();
                if (key === "public") onScope("PUBLIC");
                if (key === "private") onScope("PRIVATE");
              },
            }}
          >
            <Button shape="circle" aria-label="More" data-testid="insight-more">
              ⋯
            </Button>
          </Dropdown>
          <Popconfirm title="Remove this insight?" okText="Remove" onConfirm={onRemove}>
            <Button shape="circle" danger aria-label="Remove insight" icon={<DeleteOutlined />} />
          </Popconfirm>
        </>
      )}
    </>
  );
}

function InsightCard({ item, onOpen }: { item: InsightSummary; onOpen: () => void }) {
  const scope = SCOPE[item.scope];
  return (
    <button type="button" className="nx-in-card-link nx-glass" onClick={onOpen} data-testid="insight-card">
      <span className="nx-in-card-top">
        <span className="nx-in-card-kinds" aria-hidden>
          {item.kinds.slice(0, 6).map((kind, index) => (
            <i key={index} className={`nx-in-kind nx-in-kind--${kind}`} />
          ))}
        </span>
        {item.pinned && <PushpinFilled className="nx-in-card-pin" aria-label="Pinned" />}
      </span>
      <span className="nx-in-card-title">{item.title}</span>
      <span className="nx-in-card-question">{item.question}</span>
      <span className="nx-in-card-meta">
        {scope.icon} {scope.label} · {item.owner.name || "—"} · {relativeTime(item.refreshed_at ?? item.updated_at)}
      </span>
    </button>
  );
}
