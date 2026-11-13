/**
 * `/charts/builder` — pick the picture first, and let it tell you what it
 * needs (§28, §44).
 *
 * The report builder already composes a question and offers seven ways to draw
 * it. This is the other half, and the reason it is a second page rather than a
 * tab: the report builder is *question-first*, and this is *picture-first*.
 * Somebody who wants a heatmap does not want to discover, after building a
 * one-dimensional question, that heatmaps were never on the menu.
 *
 * Three decisions worth stating.
 *
 * **Every kind the platform themes is offered, and the ones the current
 * question cannot feed are refused with the reason** (§76). "Heatmap — needs a
 * second grouping" teaches somebody that heatmaps exist and how to get one;
 * quietly listing seven of fourteen teaches nothing, which is exactly what the
 * report builder did. What each kind needs is declared beside the renderer
 * that needs it (`components/charts/shapes.ts`), never listed here.
 *
 * **The gallery is drawn from the live data, not from icons.** A thumbnail of
 * the reader's own numbers answers "is this the right picture" in a way a
 * generic sample never does — and it is the same `panelFor` bridge the big
 * preview uses, so what is picked is what was seen.
 *
 * **A chart is a saved analysis, which is what a report already is.** There is
 * no second table, no second sharing model and no second lifecycle: this saves
 * through `reportsApi` with the chosen `visualization`, so a chart appears on
 * `/reports`, runs through the same compiler, and can be opened in either
 * builder. Two stores for one stored object is how "my chart" and "my report"
 * end up disagreeing about the same numbers.
 *
 * The layout was rebuilt for the same reason the report builder's was: the
 * question was an eight-field column, the gallery was squeezed into what was
 * left, and the button that saves the chart sat below both of them. The
 * question is now one bar (`components/analysis/QuestionBar`), the gallery
 * gets the full width, and saving is a dialog from the header — all three
 * shared with the report builder, which had drifted copies of every one.
 */

import { Alert, Skeleton } from "antd";

import { ApiError } from "@/api/client";
import { SaveAnalysisDialog } from "@/components/analysis/SaveAnalysisDialog";
import { apiErrorDetails } from "@/components/feedback/apiErrorDetails";

import { BuilderHeader } from "./parts/BuilderHeader";
import { BuilderPreview } from "./parts/BuilderPreview";
import { BuilderSide } from "./parts/BuilderSide";
import { useChartBuilderPage } from "./useChartBuilderPage";

export default function ChartBuilderPage() {
  const page = useChartBuilderPage();
  const { saving, setSaving, editingId, catalogue, existing, stored, chosen, blocked, save } = page;
  if (catalogue.isLoading || (editingId && existing.isLoading)) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  return (
    <>
      <BuilderHeader page={page} />

      {save.error instanceof ApiError && (
        <Alert
          className="nu-block"
          type="error"
          showIcon
          message={save.error.message}
          description={apiErrorDetails(save.error, 2)}
        />
      )}

      {/* A side panel holding the question and the pictures, and the answer
          beside it at full height — the canvas's builder layout. */}
      <div className="nx-ov-builder">
        <BuilderSide page={page} />

        <BuilderPreview page={page} />
      </div>

      <SaveAnalysisDialog
        open={saving}
        noun="chart"
        existing={stored}
        saving={save.isPending}
        blocked={
          blocked
            ? `${chosen?.label} ${blocked} — it would be saved as a picture that cannot be drawn.`
            : null
        }
        onClose={() => setSaving(false)}
        onSave={(values) => save.mutate(values)}
      />
    </>
  );
}
