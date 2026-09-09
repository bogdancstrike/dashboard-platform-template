/**
 * `/reports/builder` — compose a question, watch it answer itself (§28, §44).
 *
 * The builder and the preview are the same query. Every control writes into
 * one draft, the draft is sent to the analysis endpoint on every change, and
 * what is saved is exactly what was previewed — there is no "generate" step in
 * which the definition could be reinterpreted.
 *
 * The page was three cards in two columns: a 700-pixel form on the left, and
 * on the right a chart, then a second form to name and share the thing. The
 * question took most of the screen, the answer took what was left, and the
 * button that saves it sat below the fold. Now the question is one bar
 * (`components/analysis/QuestionBar`), the answer gets the whole width, and
 * saving is a dialog opened from the header, where a page's primary action
 * belongs.
 *
 * What the reader may pick comes from `/api/analysis/catalog`, generated from
 * the resource declarations — so the builder cannot offer a column the
 * compiler will reject, and a field added to a dataset appears here with no
 * change to this file.
 *
 * The draft lives in the URL (§69, §72), which is what lets "Save as a report"
 * on the analytics workspace hand its context straight to this page, and what
 * lets a half-built report be pasted to a colleague.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App as AntApp, Button, Skeleton, Space, Tooltip, Typography } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import { useState } from "react";
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
import { ChartKindStrip } from "@/components/charts/ChartKindStrip";
import { missingFor, shapeFor } from "@/components/charts/shapes";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import {
  DRAFT_KEYS,
  draftDimensions,
  draftIsRunnable,
  draftMeasures,
  readDraft,
} from "@/entities/analysisDraft";

const { Text } = Typography;

/**
 * The kinds a *report* offers.
 *
 * Fewer than the chart builder's thirteen, deliberately: this page is
 * question-first, and the kinds that need a second measure or a second
 * grouping are ones somebody arrives at by picking the picture. The chart
 * builder is one click away and carries the same draft.
 */
const CHARTS: ChartKind[] = ["bar", "hbar", "line", "area", "pie", "stacked-bar", "treemap"];

export default function ReportBuilderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const [saving, setSaving] = useState(false);

  const editingId = params.get("id") ?? "";

  const catalogue = useQuery({
    queryKey: ["analysis-catalogue"],
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: 300_000,
  });

  // The report being edited, when there is one. Its stored definition seeds
  // the draft, so "Edit" opens the question rather than a blank form.
  const existing = useQuery({
    queryKey: ["report", editingId],
    queryFn: ({ signal }) => reportsApi.get(editingId, signal),
    enabled: Boolean(editingId),
  });

  const stored = existing.data;
  const draft = readDraft(params, {
    resource: stored?.resource_type ?? catalogue.data?.datasets[0]?.key ?? "",
    group: stored?.dimensions[0]?.field ?? "",
    grain: stored?.dimensions[0]?.granularity ?? "",
    stack: stored?.dimensions[1]?.field ?? "",
    aggregation: stored?.metrics[0]?.aggregation ?? "count",
    measure: stored?.metrics[0]?.field ?? "",
    period: stored?.period ?? "last_90_days",
    chart: stored?.visualization ?? "bar",
  });

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const dimensions = draftDimensions(draft);
  const measures = draftMeasures(draft);
  const runnable = draftIsRunnable(draft);

  const preview = useQuery({
    queryKey: ["analysis", "builder", draft.resource, dimensions, measures, draft.period],
    queryFn: ({ signal }) =>
      analysisApi.run(
        {
          resource_type: draft.resource,
          dimensions,
          measures,
          period: draft.period,
        } satisfies AnalysisRequest,
        signal,
      ),
    enabled: runnable,
    placeholderData: (previous) => previous,
  });

  /**
   * Whether the chosen picture can be drawn from this question.
   *
   * The same rule the chart builder refuses a tile with, read from the shape
   * declarations rather than restated — a report saved as a picture that
   * cannot be drawn is a report that opens empty.
   */
  const shape = shapeFor(draft.chart as ChartKind);
  const blocked = shape
    ? missingFor(shape, {
        dimensions: dimensions.length,
        measures: measures.length,
        overTime: Boolean(draft.grain && draft.group),
      })
    : null;

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
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      setSaving(false);
      navigate(`/reports?report=${saved.id}`);
    },
  });

  usePageCommands("report-builder", [
    {
      id: "builder.save",
      label: "Save this report",
      keywords: "store keep name",
      run: () => setSaving(true),
    },
    {
      id: "builder.chart",
      label: "Open this question in the chart builder",
      keywords: "picture kinds gallery",
      run: () => navigate(`/charts/builder?${params.toString()}`),
    },
    {
      id: "builder.reports",
      label: "Back to reports",
      keywords: "list saved",
      run: () => navigate("/reports"),
    },
  ]);

  if (catalogue.isLoading || (editingId && existing.isLoading)) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  return (
    <>
      <PageHeader
        title={editingId ? `Edit ${stored?.name ?? "report"}` : "Build a report"}
        subtitle="The preview is the query that will be saved — there is no step in between."
        onBack={() => navigate("/reports")}
        actions={
          <Space size={8}>
            <Button onClick={() => navigate(`/charts/builder?${params.toString()}`)}>
              Pick a picture instead
            </Button>
            <Tooltip title={runnable ? "" : "Pick a column to measure first"}>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                disabled={!runnable}
                onClick={() => setSaving(true)}
                data-testid="open-save-report"
              >
                {editingId ? "Save changes" : "Save report"}
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
          description={
            <Space direction="vertical" size={2}>
              {save.error.missingPermissions.length > 0 && (
                <Text type="secondary">Missing: {save.error.missingPermissions.join(", ")}</Text>
              )}
              <Text code copyable={{ text: save.error.correlationId }}>
                {save.error.correlationId}
              </Text>
            </Space>
          }
        />
      )}

      {/* The question: one bar, so the answer below it gets the page. */}
      <div data-testid="report-question">
        <QuestionBar catalogue={catalogue.data} draft={draft} onChange={set} />
      </div>

      {!runnable ? (
        <Alert
          className="nu-block"
          type="info"
          showIcon
          message="Pick a column to measure"
          description="Every aggregation except a row count needs one."
        />
      ) : (
        <ChartCard
          id="report-preview"
          className="nu-block"
          height={420}
          loading={preview.isLoading}
          error={preview.error ?? undefined}
          onRetry={() => void preview.refetch()}
          panel={
            blocked
              ? undefined
              : panelFor(preview.data, draft.chart as ChartKind, undefined, preview.data?.description)
          }
          // One message, in the place the answer would be. A card that says
          // "Nothing in this period" over a banner that says "Bar needs a
          // grouping" gives a reader two explanations and no answer, and only
          // the second one is true.
          empty={
            blocked
              ? {
                  title: `${shape?.label ?? "This picture"} ${blocked}`,
                  hint: "Group the question in the bar above, or pick a picture that fits it.",
                }
              : undefined
          }
          // The kind lives in the chart's own header, beside the table and
          // download controls every chart in the product carries: "how shall
          // this be drawn" is a property of the picture, not a ninth field of
          // the question.
          extra={
            <ChartKindStrip
              kinds={CHARTS}
              value={draft.chart}
              onChange={(next) => set({ [DRAFT_KEYS.chart]: next })}
            />
          }
        />
      )}

      <SaveAnalysisDialog
        open={saving}
        noun="report"
        existing={stored}
        saving={save.isPending}
        blocked={blocked ? `${shape?.label} ${blocked}` : null}
        onClose={() => setSaving(false)}
        onSave={(values) => save.mutate(values)}
      />
    </>
  );
}
