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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App as AntApp, Button, Card, Col, Row, Select, Skeleton, Space, Tooltip, Typography } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { analysisApi, panelFor, type AnalysisRequest } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import { reportsApi, type ReportInput } from "@/api/reports";
import { ChartCard } from "@/components/ChartCard";
import { QuestionBar } from "@/components/analysis/QuestionBar";
import {
  SaveAnalysisDialog,
  type SaveAnalysisValues,
} from "@/components/analysis/SaveAnalysisDialog";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { ChartKindIcon } from "@/components/charts/ChartKindIcon";
import { CHART_SHAPES, missingFor, type ChartShape } from "@/components/charts/shapes";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { EmptyState } from "@/components/EmptyState";
import {
  DRAFT_KEYS,
  draftDimensions,
  draftIsRunnable,
  draftMeasures,
  readDraft,
} from "@/entities/analysisDraft";
import { STALE, queryKeys } from "@/lib/queryKeys";
import { applyParamChanges } from "@/hooks/useUrlState";
import { apiErrorDetails } from "@/components/feedback/apiErrorDetails";

const { Text } = Typography;

export default function ChartBuilderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const [saving, setSaving] = useState(false);

  const editingId = params.get("id") ?? "";
  const [bothThemes, setBothThemes] = useState(false);
  /** The big chart takes most of the window's height, not a fixed strip. */
  const [chartHeight, setChartHeight] = useState(() =>
    Math.max(360, Math.round(window.innerHeight * 0.62)),
  );
  useEffect(() => {
    const resize = () => setChartHeight(Math.max(360, Math.round(window.innerHeight * 0.62)));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const catalogue = useQuery({
    queryKey: queryKeys.analysisCatalogue(),
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: STALE.long,
  });

  // The saved chart being edited, when there is one. It is a report, because a
  // chart is a saved analysis and so is a report.
  const existing = useQuery({
    queryKey: queryKeys.report(editingId),
    queryFn: ({ signal }) => reportsApi.get(editingId, signal),
    enabled: Boolean(editingId),
  });

  const datasets = catalogue.data?.datasets ?? [];
  const stored = existing.data;
  const draft = readDraft(params, {
    resource: stored?.resource_type ?? datasets[0]?.key ?? "",
    group: stored?.dimensions[0]?.field ?? "",
    grain: stored?.dimensions[0]?.granularity ?? "",
    stack: stored?.dimensions[1]?.field ?? "",
    aggregation: stored?.metrics[0]?.aggregation ?? "count",
    measure: stored?.metrics[0]?.field ?? "",
    aggregation2: stored?.metrics[1]?.aggregation ?? "",
    measure2: stored?.metrics[1]?.field ?? "",
    period: stored?.period ?? "last_90_days",
    chart: stored?.visualization ?? "bar",
  });

  /**
   * The grouping a fresh chart starts on: the dataset's first *categorical*
   * column (a status, a priority). Grouping by a title or a reference draws
   * one sliver per record, which is a rainbow rather than an answer.
   */
  const sensibleGroup = (resource: string) =>
    datasets
      .find((item) => item.key === resource)
      ?.dimensions.find((item) => item.kind === "enum")?.name ?? "";

  // A page opened with no question starts on a sensible one rather than on
  // "nothing — one row", which draws a single bar.
  useEffect(() => {
    if (editingId || datasets.length === 0 || params.has("resource")) return;
    const resource = datasets[0]?.key ?? "";
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("resource", resource);
        const group = sensibleGroup(resource);
        if (group) next.set("group", group);
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, datasets.length]);

  /** How many values to draw before the rest fold into "Other". */
  const top = Number(params.get("top") ?? 10);
  const overTime = datasets
    .find((item) => item.key === draft.resource)
    ?.dimensions.find((item) => item.name === draft.group)?.kind === "datetime";

  const setRaw = (changes: Record<string, string | null>) =>
    setParams(
      (current) => applyParamChanges(current, changes),
      { replace: true },
    );

  /** Choosing a new dataset also chooses a sensible grouping in it. */
  const set = (changes: Record<string, string | null>) => {
    if (changes[DRAFT_KEYS.resource] && !changes[DRAFT_KEYS.group]) {
      const group = sensibleGroup(changes[DRAFT_KEYS.resource] ?? "");
      setRaw({ ...changes, [DRAFT_KEYS.group]: group || null });
      return;
    }
    setRaw(changes);
  };

  const dimensions = draftDimensions(draft);
  const measures = draftMeasures(draft);

  /** What the gallery asks of each kind: how many of each thing there are. */
  const shapeDraft = useMemo(
    () => ({
      dimensions: dimensions.length,
      measures: measures.length,
      overTime: Boolean(draft.grain && draft.group),
    }),
    [dimensions.length, measures.length, draft.grain, draft.group],
  );

  const preview = useQuery({
    queryKey: queryKeys.analysis("chart-builder", draft.resource, dimensions, measures, draft.period, overTime ? 0 : top),
    queryFn: ({ signal }) =>
      analysisApi.run(
        {
          resource_type: draft.resource,
          dimensions,
          measures,
          period: draft.period,
          // Over time every bucket is drawn; otherwise the top N, with the
          // rest folded into "Other" by the server so the parts still add up.
          ...(overTime ? {} : { limit: top }),
        } satisfies AnalysisRequest,
        signal,
      ),
    enabled: draftIsRunnable(draft),
    placeholderData: (previous) => previous,
  });

  const chosen = CHART_SHAPES.find((shape) => shape.kind === draft.chart);
  const blocked = chosen ? missingFor(chosen, shapeDraft) : null;
  const panel = panelFor(preview.data, draft.chart as ChartKind);

  const save = useMutation({
    mutationFn: (values: SaveAnalysisValues) => {
      const input: ReportInput = {
        ...values,
        resource_type: draft.resource,
        dimensions,
        metrics: measures,
        period: draft.period,
        visualization: draft.chart,
      };
      return editingId ? reportsApi.update(editingId, input) : reportsApi.create(input);
    },
    onSuccess: (saved) => {
      message.success(editingId ? `${saved.name} saved` : `${saved.name} created`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports() });
      setSaving(false);
      navigate(`/reports?report=${saved.id}`);
    },
  });

  usePageCommands("chart-builder", [
    { id: "chart.save", label: "Save this chart", keywords: "store keep", run: () => setSaving(true) },
    {
      id: "chart.report",
      label: "Open this question in the report builder",
      keywords: "report table",
      run: () => navigate(`/reports/builder?${params.toString()}`),
    },
    { id: "chart.reports", label: "Back to reports", keywords: "list saved", run: () => navigate("/reports") },
    {
      id: "chart.records",
      label: "See the records behind this chart",
      keywords: "explore rows records underneath drill",
      run: () => navigate(`/explore?resource=${draft.resource}`),
    },
    {
      id: "chart.restart",
      label: "Start a new chart",
      keywords: "new clear reset blank fresh question",
      run: () => navigate("/charts/builder"),
    },
  ]);

  if (catalogue.isLoading || (editingId && existing.isLoading)) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  return (
    <>
      <PageHeader
        title={
          editingId ? (
            `Edit ${stored?.name ?? "chart"}`
          ) : (
            <span>
              Chart <em>builder</em>
            </span>
          )
        }
        subtitle="Pick a picture and it will tell you what it needs. Every kind is drawn from your own data, in both themes."
        onBack={() => navigate("/reports")}
        actions={
          <Space size={8}>
            <Button onClick={() => navigate(`/reports/builder?${params.toString()}`)}>
              Open in the report builder
            </Button>
            <Tooltip
              title={
                !draftIsRunnable(draft)
                  ? "Pick a column to measure first"
                  : blocked
                    ? `${chosen?.label} ${blocked}`
                    : ""
              }
            >
              <Button
                type="primary"
                icon={<SaveOutlined />}
                disabled={!draftIsRunnable(draft) || Boolean(blocked)}
                onClick={() => setSaving(true)}
                data-testid="open-save-chart"
              >
                {editingId ? "Save changes" : "Save chart"}
              </Button>
            </Tooltip>
          </Space>
        }
      />

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
      <aside className="nx-ov-builder-side nx-glass">
        <section className="nx-ov-builder-step">
          <h2 className="nx-ov-builder-h"><span>1</span>Ask the question</h2>
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
              <Text type="secondary" className="nu-question-label">Show</Text>
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
          <h2 className="nx-ov-builder-h"><span>2</span>Pick the picture</h2>
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

      <div className="nx-ov-builder-main">
      {/* The chosen picture, as large as the window allows, with the chrome
          every chart in the product has: read it as a table, take the
          numbers away. */}
      <div className="nu-block" data-testid="chart-preview">
        <ChartCard
          id="chart-builder"
          panel={blocked ? undefined : panel}
          height={chartHeight}
          loading={preview.isFetching && !preview.data}
          error={preview.error ?? undefined}
          onRetry={() => void preview.refetch()}
          extra={
            <Button
              type="text"
              aria-pressed={bothThemes}
              onClick={() => setBothThemes(!bothThemes)}
              data-testid="toggle-themes"
            >
              {bothThemes ? "Hide themes" : "Both themes"}
            </Button>
          }
          empty={
            blocked
              ? {
                  title: `${chosen?.label ?? "This picture"} ${blocked}`,
                  hint: "Pick a tile that fits the question, or add what it needs on the left.",
                }
              : undefined
          }
        />
      </div>

      {/* The same chart in both appearances, on request: a chart checked only
          in the theme its author uses is a chart nobody checked in the other —
          but it is a check, not the page, so it waits to be asked for. */}
      {bothThemes && (
        <Card size="small" title="In both themes" className="nu-block" data-testid="chart-themes">
          <Row gutter={[12, 12]}>
            {(["light", "dark"] as const).map((mode) => (
              <Col xs={24} xl={12} key={mode}>
                <ChartPreview
                  panel={blocked ? undefined : panel}
                  mode={mode}
                  height={340}
                  label={mode === "light" ? "Light" : "Dark"}
                />
              </Col>
            ))}
          </Row>
        </Card>
      )}
      </div>
      </div>

      <SaveAnalysisDialog
        open={saving}
        noun="chart"
        existing={stored}
        saving={save.isPending}
        blocked={blocked ? `${chosen?.label} ${blocked} — it would be saved as a picture that cannot be drawn.` : null}
        onClose={() => setSaving(false)}
        onSave={(values) => save.mutate(values)}
      />

    </>
  );
}

/**
 * One kind in the gallery: the picture, its name, and why it is unavailable.
 *
 * A disabled button rather than an absent one, with the missing piece named —
 * the reader learns that the kind exists and what would unlock it (§76).
 */
function Thumbnail({
  shape,
  missing,
  chosen,
  onChoose,
}: {
  shape: ChartShape;
  missing: string | null;
  chosen: boolean;
  onChoose: () => void;
}) {
  const className = [
    "nu-gallery-item",
    chosen ? "is-chosen" : "",
    missing ? "is-blocked" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tooltip title={missing ? `${shape.label} ${missing}` : shape.question}>
      <button
        type="button"
        className={className}
        aria-pressed={chosen}
        aria-label={missing ? `${shape.label} — ${missing}` : `${shape.label} — ${shape.question}`}
        disabled={Boolean(missing)}
        onClick={onChoose}
        data-testid={`chart-kind-${shape.kind}`}
      >
        <span className="nu-gallery-canvas">
          <ChartKindIcon kind={shape.kind} />
        </span>
        <span className="nu-gallery-label">{shape.label}</span>
      </button>
    </Tooltip>
  );
}
