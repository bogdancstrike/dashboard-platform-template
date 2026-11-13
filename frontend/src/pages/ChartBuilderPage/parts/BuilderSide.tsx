import { Select, Typography } from "antd";

import { QuestionBar } from "@/components/analysis/QuestionBar";
import { CHART_SHAPES, missingFor } from "@/components/charts/shapes";
import { EmptyState } from "@/components/EmptyState";
import { DRAFT_KEYS, draftIsRunnable } from "@/entities/analysisDraft";

import { Thumbnail } from "../parts/Thumbnail";
const { Text } = Typography;

import type { ChartBuilderPageData } from "../useChartBuilderPage";

/** The question and the pictures it can be drawn as. */
export function BuilderSide({ page }: { page: ChartBuilderPageData }) {
  const { catalogue, draft, top, overTime, setRaw, set, shapeDraft } = page;
  return (
    <aside className="nx-ov-builder-side nx-glass">
      <section className="nx-ov-builder-step">
        <h2 className="nx-ov-builder-h">
          <span>1</span>Ask the question
        </h2>
        <p className="nx-ov-builder-help">Which records, how to group them, and what to count.</p>
        <div data-testid="chart-question">
          <QuestionBar
            catalogue={catalogue.data}
            draft={draft}
            onChange={set}
            // Only here: a scatter is the one picture that reads two
            // measures, and the report builder offers no scatter.
            withSecondMeasure
          />
        </div>
        {draft.group && !overTime && (
          <div className="nu-question-part nx-ov-topn">
            <Text type="secondary" className="nu-question-label">
              Show
            </Text>
            <Select
              aria-label="How many values to show"
              className="nu-question-select"
              value={top}
              onChange={(next: number) => setRaw({ top: next === 10 ? null : String(next) })}
              options={[5, 10, 15, 25, 50].map((value) => ({
                value,
                label: `The top ${value}, the rest as “Other”`,
              }))}
            />
          </div>
        )}
      </section>

      {/* Every kind, refused with the reason when the question cannot feed
          it (§76) — the reason is the tile's tooltip and its name for a
          screen reader, never text crammed into the tile. */}
      <section className="nx-ov-builder-gallery" data-testid="chart-gallery">
        <h2 className="nx-ov-builder-h">
          <span>2</span>Pick the picture
        </h2>
        {!draftIsRunnable(draft) ? (
          <EmptyState compact title="Pick a measure and the pictures will draw themselves" />
        ) : (
          <>
            <div className="nu-gallery">
              {CHART_SHAPES.map((shape) => (
                <Thumbnail
                  key={shape.kind}
                  shape={shape}
                  missing={missingFor(shape, shapeDraft)}
                  chosen={shape.kind === draft.chart}
                  onChoose={() => set({ [DRAFT_KEYS.chart]: shape.kind })}
                />
              ))}
            </div>
            <p className="nx-ov-builder-help">
              Dimmed kinds need more of the question — hover one to see what.
            </p>
          </>
        )}
      </section>
    </aside>
  );
}
