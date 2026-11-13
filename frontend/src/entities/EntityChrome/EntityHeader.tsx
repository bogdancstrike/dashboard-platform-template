import { PageHeader } from "@/components/PageHeader";
import type { EntityView } from "@/entities/useEntityView";

import { EntityTools } from "./EntityTools";
import { QualityChip } from "./QualityChip";

/** Title, live count, export and the escape hatch to the Data Explorer. */
export function EntityHeader({
  view,
  title,
  subtitle,
  actions,
}: {
  view: EntityView;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  const { resource, rows } = view;

  return (
    <>
      <PageHeader
        title={title ?? resource?.label ?? ""}
        subtitle={subtitle ?? resource?.description ?? ""}
        actions={actions}
      />
      {/* The glass design's toolbar row: what the list holds on the left, the
          ways to keep, re-ask and take it away on the right. */}
      <div className="nx-rec-toolbar">
        {rows.data && resource ? (
          <>
            <span className="nx-rec-count" data-testid="entity-total">
              {rows.data.total.toLocaleString()} of {resource.record_count.toLocaleString()}
            </span>
            <QualityChip resourceKey={resource.key} />
          </>
        ) : null}
        <span className="nx-rec-spacer" />
        <EntityTools view={view} />
      </div>
    </>
  );
}
