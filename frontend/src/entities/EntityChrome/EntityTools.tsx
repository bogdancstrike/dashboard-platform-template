import { App as AntApp, Button } from "antd";
import { ClearOutlined, SearchOutlined, TableOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { explorerApi, type ExplorerRequest } from "@/api/explorer";
import { exportsApi, type ExportRequest } from "@/api/exports";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ExportButton } from "@/components/ExportButton";
import { SavedViewMenu } from "@/entities/SavedViewMenu";
import type { EntityView } from "@/entities/useEntityView";
import { FEATURES, useFeature } from "@/settings/features";

/**
 * The right-hand side of a list's toolbar: refresh, saved views, clear, the
 * wider question, the grid and the export — the same on every entity list.
 */
export function EntityTools({ view }: { view: EntityView }) {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const gridOn = useFeature(FEATURES.spreadsheetGrid);
  const { resource, rows, request, filterCount, clearFilters } = view;

  return (
    <div className="nx-rec-tools">
      {/* A list is an answer that goes quietly out of date, so it says how
          old it is and lets the reader decide how often it is re-asked
          (§53). Off by default, remembered per dataset. */}
      <AutoRefresh
        page={`list:${resource?.key ?? "unknown"}`}
        updatedAt={rows.dataUpdatedAt}
        busy={rows.isFetching}
        refresh={() => {
          void rows.refetch();
          void view.insights.refetch();
        }}
      />
      {/* Here rather than on each page, for the reason the quality chip is:
          a list gets its saved views by being a list (§46). */}
      <SavedViewMenu view={view} />
      {filterCount > 0 && (
        <Button icon={<ClearOutlined />} onClick={clearFilters}>
          Clear {filterCount} filter{filterCount === 1 ? "" : "s"}
        </Button>
      )}
      <Button
        icon={<SearchOutlined />}
        aria-label="Ask a wider question"
        onClick={() => navigate(`/explore?resource=${resource?.key ?? ""}`)}
      >
        Ask a wider question
      </Button>
      {/* Records & analytics (§18): the same list as a spreadsheet. */}
      {resource && gridOn && (
        <Button
          data-testid="open-grid"
          // An icon, because a phone shows the toolbar as icons only: with
          // none, this was an empty circle with no name.
          icon={<TableOutlined />}
          aria-label="Edit as grid"
          onClick={() => {
            const query = new URLSearchParams({ ...view.filters, ...(view.search ? { q: view.search } : {}) });
            navigate(`${resource.path}/grid${query.toString() ? `?${query}` : ""}`);
          }}
        >
          Edit as grid
        </Button>
      )}
      {/* Both take the same request, so an export that had to be queued
          because it was large is provably the question on screen (§30).
          Every entity list gets this by being here. */}
      <ExportButton
        disabled={!request}
        onExport={(format) =>
          explorerApi.export({ ...(request as ExplorerRequest), page: 1, format })
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
