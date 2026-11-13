/**
 * Record version history with point-in-time restore (§17).
 *
 * The list is every version the audit trail can rebuild, newest first. Two
 * of them are compared side by side — pick "A" and "B" — and from the
 * comparison a whole version or single fields can be put back, after a
 * confirmation, by anybody holding the edit permission and `records.restore`.
 * "View as of" jumps to the version in force at a date.
 *
 * Used as a panel on the generic record page's History tab, and as a drawer
 * (URL key `?versions=1`) from the task, project, ticket and contract pages.
 */
import "@/styles/records-analytics.css";

import { Button, Drawer, Skeleton } from "antd";

import { URL_OVERLAY } from "@/app/history";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { FailureAlert } from "@/components/FailureAlert";
import { EmptyState } from "@/components/EmptyState";
import { FEATURES, withFeature } from "@/settings/features";

import { useVersionHistory } from "./useVersionHistory";
import { VersionDiff } from "./VersionDiff";
import { VersionList } from "./VersionList";

export { displayValue } from "./displayValue";

function VersionHistoryInner({
  resourceType,
  recordId,
  narrow = false,
  onRestored,
}: {
  resourceType: string;
  recordId: string;
  narrow?: boolean;
  onRestored?: () => void;
}) {
  const model = useVersionHistory(resourceType, recordId, onRestored);
  const { history, data, asOf, setAsOf, screens } = model;
  if (history.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (history.isError) {
    return <FailureAlert error={history.error} onRetry={() => void history.refetch()} titles={{ not_found: "No version that early" }}
      action={asOf ? <Button onClick={() => setAsOf(null)}>Back to now</Button> : undefined} />;
  }
  if (!data || data.versions.length === 0) return <EmptyState title="No history recorded for this record yet" />;

  const stacked = narrow || !screens.lg;

  return (
    <div className={`nx-ra-versions${stacked ? " nx-ra-versions--narrow" : ""}`} data-testid="version-history">
      <VersionList model={model} />
      <VersionDiff model={model} />
    </div>
  );
}

/** A button that opens the history as a URL-driven drawer (`?versions=1`). */
function VersionHistoryButtonInner({ resourceType, recordId }: { resourceType: string; recordId: string }) {
  const overlay = useUrlOverlay("versions");
  return (
    <>
      <Button onClick={() => overlay.open("1")} data-testid="open-versions">
        Versions & restore
      </Button>
      <Drawer
        open={overlay.value === "1"}
        onClose={overlay.close}
        title="Version history"
        width="min(980px, 100vw)"
        rootClassName={URL_OVERLAY}
        destroyOnClose
      >
        <VersionHistory resourceType={resourceType} recordId={recordId} />
      </Drawer>
    </>
  );
}

/** Rendered only while its feature flag is on (§27). */
export const VersionHistory = withFeature(FEATURES.versionHistory, VersionHistoryInner);

/** Rendered only while its feature flag is on (§27). */
export const VersionHistoryButton = withFeature(FEATURES.versionHistory, VersionHistoryButtonInner);
