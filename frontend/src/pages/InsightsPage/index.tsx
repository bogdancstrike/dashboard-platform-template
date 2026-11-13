import { Alert, Button, Skeleton, Typography } from "antd";

import { AddToDashboard } from "@/components/dashboards/AddToDashboard";
import { EmptyState } from "@/components/EmptyState";
import { NameModal } from "@/components/NameModal";
import { PageHeader } from "@/components/PageHeader";

import { AskBox } from "./parts/AskBox";
import { InsightGallery } from "./parts/InsightGallery";
import { InsightPanel } from "./parts/InsightPanel";
import { useInsightsPage } from "./useInsightsPage";

const { Text } = Typography;

export default function InsightsPage() {
  const page = useInsightsPage();
  const {
    back,
    question,
    failure,
    renaming,
    setRenaming,
    dashboardFor,
    setDashboardFor,
    openId,
    saved,
    generate,
    update,
    busy,
    current,
    ask,
  } = page;

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

      <AskBox page={page} />

      {failure && (
        <Alert
          type="warning"
          showIcon
          className="nu-block"
          message={failure}
          data-testid="insight-failure"
          action={question.trim() ? <Button onClick={() => ask()}>Try again</Button> : undefined}
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
            {generate.isPending
              ? "Looking at your data and laying out the page…"
              : "Reading the numbers…"}
          </Text>
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      )}

      <InsightPanel page={page} />

      {!busy && openId && saved.isError && (
        <EmptyState
          title="That insight is not available"
          hint="It was removed, or it is no longer shared with you."
        />
      )}
      {!busy && openId && saved.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}

      <InsightGallery page={page} />

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
      <AddToDashboard
        open={dashboardFor !== null}
        subject={dashboardFor}
        onClose={() => setDashboardFor(null)}
      />
    </div>
  );
}
