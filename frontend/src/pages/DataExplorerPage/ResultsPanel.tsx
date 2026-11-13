import { Alert, App as AntApp, Button, Segmented, Select, Skeleton, Tooltip, Typography } from "antd";

import { exportsApi, type ExportRequest } from "@/api/exports";
import { explorerApi } from "@/api/explorer";
import { NxIcon } from "@/components/NxIcon";
import { ExplorerResults } from "@/components/explorer/ExplorerResults";
import { ExportButton } from "@/components/ExportButton";
import { errorText } from "@/lib/errors";
import { EmptyState } from "@/components/EmptyState";

import { VIEW_OPTIONS } from "./explorerUrl";
import { ColumnPicker, GroupPicker } from "./pickers";
import type { ExplorerPage } from "./useExplorerPage";

const { Text } = Typography;

/** The count, the tools and the rows — in the view the address asks for. */
export function ResultsPanel({ m }: { m: ExplorerPage }) {
  const { bulk, bulkAllowed, catalogue, groupBy, loadMore, mode, noun, openPanel, requestedResource, resource, results, scanned, scanning, set, settling, total, view } = m;
  return (
    <section className="nx-fd-results nx-glass" aria-label="Results">
      <div className="nx-fd-reshead">
        <div className="nx-fd-count">
          {mode === "start" ? (
            <span className="nx-fd-h2">All {noun}</span>
          ) : (
            <>
              <span className="nx-fd-countn">{total === undefined ? "—" : total.toLocaleString()}</span>
              <span className="nx-fd-countnoun">{noun}</span>
            </>
          )}
          {results.data && (
            <span
              className={mode === "start" ? "nx-fd-pill nx-fd-pill--acc" : "nx-fd-sr"}
              data-testid="explorer-match-count"
            >
              {results.data.total.toLocaleString()} {results.data.total === 1 ? "match" : "matches"}
            </span>
          )}
          {resource && mode !== "start" && (
            <span className="nx-fd-muted nx-fd-small">of {resource.record_count.toLocaleString()}</span>
          )}
          {settling && <Text type="secondary" data-testid="explorer-settling">Updating…</Text>}
        </div>
        <ResultsTools m={m} />
      </div>
      {results.isError && (
        <Alert style={{ marginBottom: 12 }} type="error" showIcon message="This question could not be run" description={errorText(results.error)} />
      )}
      {/* Above the rows it acts on, and only once something is ticked. A bar
          that is always there is a bar nobody reads when it matters. */}
      {bulkAllowed && bulk.bar}
      {!resource && catalogue.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : !resource ? (
        <EmptyState title="Your role has no explorable datasets" />
      ) : (
        <ExplorerResults
          result={results.data}
          view={view}
          loading={results.isLoading}
          {...(scanning
            ? { rows: scanned, groupBy, onLoadMore: loadMore, loadingMore: results.isFetching }
            : {})}
          onPage={(nextPage, nextSize) => set({ page: nextPage, page_size: nextSize })}
          onSort={(field, direction) => set({ sort: field, order: direction, page: null })}
          onPreview={(record) => openPanel({ record: record.id, resource: results.data?.resource_type ?? requestedResource })}
          // Ticking is offered only in the table. A card grid with tick
          // boxes on it is a table wearing a costume, and the scanning views
          // exist for reading rather than for acting (§6).
          {...(view === "table" && bulkAllowed ? { selection: bulk.rowSelection } : {})}
          starrable
          path={resource?.path ?? ""}
        />
      )}
    </section>
  );
}

/** Sort, order, columns, grouping, the view and the export, beside the count. */
export function ResultsTools({ m }: { m: ExplorerPage }) {
  const { message } = AntApp.useApp();
  const { columns, groupBy, navigate, order, request, resource, scanning, set, sort, sortable, view } = m;
  return (
    <div className="nx-fd-restools">
      {sortable.length > 0 && (
        <Select
          className="nx-fd-sort"
          aria-label="Sort by"
          value={sort}
          popupMatchSelectWidth={false}
          onChange={(next: string) => set({ sort: next, page: null })}
          labelRender={() => (
            <span className="nx-fd-typelabel">
              <span className="nx-fd-muted">Sort</span>
              <b>{sortable.find((field) => field.name === sort)?.label ?? sort}</b>
            </span>
          )}
          options={sortable.map((field) => ({ value: field.name, label: field.label }))}
        />
      )}
      <Tooltip title={order === "asc" ? "Ascending — press for descending" : "Descending — press for ascending"}>
        <Button
          className="nx-fd-order"
          aria-label={order === "asc" ? "Sorted ascending" : "Sorted descending"}
          icon={<span style={{ display: "inline-flex", transform: order === "asc" ? "scaleY(-1)" : undefined }}><NxIcon name="chevronDown" size={14} /></span>}
          onClick={() => set({ order: order === "asc" ? "desc" : "asc", page: null })}
        />
      </Tooltip>
      <ColumnPicker resource={resource} value={columns} onChange={(next) => set({ columns: next.join(","), page: null })} />
      {scanning && (
        <GroupPicker
          resource={resource}
          value={groupBy}
          onChange={(next) => set({ group: next || null, page: null })}
        />
      )}
      <Segmented
        className="nx-fd-views"
        data-testid="view-mode"
        value={view}
        options={VIEW_OPTIONS}
        onChange={(next) => set({ view: String(next), page: null })}
      />
      {/* Exports the question, not the page — the same request the
          results came from, without its LIMIT. And when that question
          is too large to download, `onQueue` asks it again as a
          background export rather than leaving the refusal as the
          answer (§30). Both take the same request, which is what makes
          the queued file provably the query on screen. */}
      <ExportButton
        disabled={!request}
        onExport={(format) =>
          explorerApi.export({ ...request!, page: 1, format })
        }
        onQueue={async (format) => {
          const made = await exportsApi.queue({
            ...(request as unknown as ExportRequest),
            format,
          });
          message.success(
            `${made.reference} queued. It will appear on the Exports page.`,
          );
          navigate("/exports");
        }}
      />
    </div>
  );
}
