import { Typography } from "antd";

import type { AnalysisCatalogue } from "@/api/analysis";
import type { DashboardWidget } from "@/api/dashboards";
import type { ExplorerResource } from "@/api/explorer";
import { EmptyState } from "@/components/EmptyState";

import { KINDS } from "../../kinds";
import { WidgetBody } from "../../WidgetBody";
import { WidgetCard, type WidgetMoves } from "../../WidgetCard";
import { PREVIEW_SIZES, ROW_HEIGHT } from "../../grid/sizes";
import { hasSubject } from "../subject";

const { Text, Paragraph } = Typography;

/**
 * A card in a preview cannot be moved, so the moves are refused rather than
 * absent: `WidgetCard` takes them whether or not it is editable, and passing
 * handlers that quietly do nothing would be a control that looks live.
 */
const NO_MOVES: WidgetMoves = {
  nudge: () => {},
  resize: () => {},
  setSize: () => {},
  edit: () => {},
  remove: () => {},
};

/** The widget as it will be, drawn beside the form from live data. */
export function WidgetPreview({
  draft,
  period,
  catalogue,
  resources,
}: {
  draft: DashboardWidget;
  period: string;
  catalogue: AnalysisCatalogue | undefined;
  resources: ExplorerResource[];
}) {
  const kind = draft.kind;
  // The size the server will actually give it, mirrored so the preview is the
  // shape the card will be rather than a rectangle chosen to look good here.
  const size = PREVIEW_SIZES[kind];
  return (
    <>
      {/* The card as it will appear on the grid — the same `WidgetCard` and
        the same `WidgetBody`, at the height of the rows it will occupy. A
        preview assembled from different components is one that is wrong the
        first week either changes, and a table in a plain box tells nobody
        what the thing will look like on the page. */}
      <aside className="nu-widget-modal-preview" aria-label="Preview">
        <Text type="secondary" className="nu-widget-modal-caption">
          How it will look
        </Text>
        <div
          className="nu-widget-modal-cell"
          // The grid's own row height, so a one-row KPI is visibly a strip and
          // a three-row calendar is visibly a panel. Guessing a height here is
          // how a preview ends up flattering every kind equally.
          style={{ height: size.h * ROW_HEIGHT + (size.h - 1) * 12 }}
        >
          <WidgetCard widget={draft} editable={false} columns={12} moves={NO_MOVES}>
            {KINDS[kind].needs !== "nothing" && !hasSubject(draft) ? (
              <EmptyState
                compact
                title={
                  <Text type="secondary">
                    {KINDS[kind].needs === "dataset"
                      ? "Pick a dataset to see it"
                      : `Pick a saved ${KINDS[kind].needs} to see it`}
                  </Text>
                }
              />
            ) : (
              <WidgetBody
                widget={draft}
                period={period}
                catalogue={catalogue}
                resources={resources}
              />
            )}
          </WidgetCard>
        </div>
        <Paragraph type="secondary" className="nu-widget-modal-question">
          Lands at the bottom of the dashboard, {size.w} columns by {size.h}{" "}
          {size.h === 1 ? "row" : "rows"} — drag its corner from there.
          {KINDS[kind].page ? ` It mirrors ${KINDS[kind].page}.` : ""}
        </Paragraph>
      </aside>
    </>
  );
}
