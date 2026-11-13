import { Alert, Button, Typography } from "antd";

import { type InsightDraft, type SavedInsight } from "@/api/insights";
import { InsightView } from "@/components/insights/InsightView";
import { relativeTime } from "@/lib/time";

import { SOURCE } from "../model";
import { SavedActions } from "../parts/SavedActions";
const { Text } = Typography;

import type { InsightsPageData } from "../useInsightsPage";

/** The insight being read: its title, its actions and its components. */
export function InsightPanel({ page }: { page: InsightsPageData }) {
  const { back, setRenaming, setDashboardFor, list, save, update, refresh, remove, busy, current } =
    page;
  return (
    <>
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
                  current.refreshed_at
                    ? `numbers from ${relativeTime(current.refreshed_at)}`
                    : null,
                  "id" in current && current.id && "owner" in current
                    ? `by ${current.owner.name}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </div>
            <div className="nx-in-actions">
              {current.id === null ? (
                <>
                  <Button onClick={() => back("/ai/insights")}>Discard</Button>
                  <Button
                    type="primary"
                    loading={save.isPending}
                    onClick={() => save.mutate(current as InsightDraft)}
                    data-testid="insight-save"
                  >
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
                  onDashboard={() =>
                    setDashboardFor({ kind: "INSIGHT", id: current.id!, title: current.title })
                  }
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
    </>
  );
}
