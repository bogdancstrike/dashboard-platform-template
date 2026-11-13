import { BlockSettings } from "../parts/BlockSettings";
import { PageSettings } from "../parts/PageSettings";
import type { ReadyBuilder } from "../useReportBuilder";

/** The selected block's settings, or the paper's. */
export function Inspector({ view }: { view: ReadyBuilder }) {
  const {
    setSelected,
    listing,
    savedReports,
    catalogue,
    canEdit,
    page,
    change,
    editBlock,
    chosen,
  } = view;
  return (
    <>
      {/* What the selected block shows, or — with nothing selected — the
          paper it is all printed on. One rail, two subjects, because a
          document has exactly those two kinds of setting. */}
      <aside className="nu-doc-inspector" aria-label="Settings">
        {chosen ? (
          <BlockSettings
            block={chosen}
            canEdit={canEdit}
            datasets={listing.data?.datasets ?? []}
            reports={savedReports.data?.items ?? []}
            catalogue={catalogue.data}
            onChange={(patch) => editBlock(chosen.id, patch)}
            onClose={() => setSelected(null)}
          />
        ) : (
          <PageSettings page={page} canEdit={canEdit} onChange={(next) => change({ page: next })} />
        )}
      </aside>
    </>
  );
}
