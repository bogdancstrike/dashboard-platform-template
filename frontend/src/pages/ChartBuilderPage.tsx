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
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Row,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Tooltip,
  Typography,
} from "antd";
import { SaveOutlined } from "@ant-design/icons";
import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { analysisApi, panelFor, type AnalysisRequest } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import { reportsApi, type ReportInput, type ReportScope } from "@/api/reports";
import { ChartCard } from "@/components/ChartCard";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { CHART_SHAPES, missingFor, type ChartShape } from "@/components/charts/shapes";
import { PageHeader } from "@/components/PageHeader";
import { MemberPicker } from "@/components/PeoplePicker";
import { usePageCommands } from "@/commands/CommandContext";
import {
  DRAFT_KEYS,
  draftDimensions,
  draftIsRunnable,
  draftMeasures,
  readDraft,
} from "@/entities/analysisDraft";

const { Text } = Typography;

export default function ChartBuilderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const [form] = Form.useForm();

  const editingId = params.get("id") ?? "";

  const catalogue = useQuery({
    queryKey: ["analysis-catalogue"],
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: 300_000,
  });

  // The saved chart being edited, when there is one. It is a report, because a
  // chart is a saved analysis and so is a report.
  const existing = useQuery({
    queryKey: ["report", editingId],
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

  const dataset = datasets.find((item) => item.key === draft.resource);

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
    queryKey: ["analysis", "chart-builder", draft.resource, dimensions, measures, draft.period],
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
    enabled: draftIsRunnable(draft),
    placeholderData: (previous) => previous,
  });

  const chosen = CHART_SHAPES.find((shape) => shape.kind === draft.chart);
  const blocked = chosen ? missingFor(chosen, shapeDraft) : null;
  const panel = panelFor(preview.data, draft.chart as ChartKind);

  const save = useMutation({
    mutationFn: (values: {
      name: string;
      description?: string;
      scope: ReportScope;
      member_ids?: string[];
      is_favorite?: boolean;
    }) => {
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
      navigate(`/reports?report=${saved.id}`);
    },
  });

  usePageCommands("chart-builder", [
    { id: "chart.save", label: "Save this chart", keywords: "store keep", run: () => void form.submit() },
    {
      id: "chart.report",
      label: "Open this question in the report builder",
      keywords: "report table",
      run: () => navigate(`/reports/builder?${params.toString()}`),
    },
    { id: "chart.reports", label: "Back to reports", keywords: "list saved", run: () => navigate("/reports") },
  ]);

  if (catalogue.isLoading || (editingId && existing.isLoading)) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  const groupings = dataset?.dimensions ?? [];
  const columns = dataset?.measures ?? [];

  return (
    <>
      <PageHeader
        title={editingId ? `Edit ${stored?.name ?? "chart"}` : "Build a chart"}
        subtitle="Pick a picture and it will tell you what it needs. Every kind is drawn from your own data, in both themes."
        onBack={() => navigate("/reports")}
        actions={
          <Button onClick={() => navigate(`/reports/builder?${params.toString()}`)}>
            Open in the report builder
          </Button>
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

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={9}>
          <Card size="small" title="The data" data-testid="chart-question">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Field label="Dataset">
                <Select
                  aria-label="Dataset"
                  style={{ width: "100%" }}
                  value={draft.resource}
                  onChange={(next) =>
                    set({
                      [DRAFT_KEYS.resource]: next,
                      [DRAFT_KEYS.group]: null,
                      [DRAFT_KEYS.stack]: null,
                      [DRAFT_KEYS.grain]: null,
                      [DRAFT_KEYS.measure]: null,
                      [DRAFT_KEYS.measure2]: null,
                      [DRAFT_KEYS.aggregation2]: null,
                    })
                  }
                  options={datasets.map((item) => ({ value: item.key, label: item.label }))}
                />
              </Field>

              <Field label="Group by" hint="The first axis, and the bucket a date is read in.">
                <Space.Compact style={{ width: "100%" }}>
                  <Select
                    aria-label="Group by"
                    style={{ width: "60%" }}
                    allowClear
                    value={draft.group || undefined}
                    placeholder="Nothing — one row"
                    onChange={(next: string | undefined) =>
                      set({ [DRAFT_KEYS.group]: next ?? null, [DRAFT_KEYS.grain]: null })
                    }
                    options={groupings.map((item) => ({ value: item.name, label: item.label }))}
                  />
                  <Select
                    aria-label="Granularity"
                    style={{ width: "40%" }}
                    allowClear
                    value={draft.grain || undefined}
                    placeholder="Bucket"
                    // Only a date buckets; offering it for an enum would be a
                    // control that produces an error rather than a result.
                    disabled={
                      groupings.find((item) => item.name === draft.group)?.kind !== "datetime"
                    }
                    onChange={(next: string | undefined) => set({ [DRAFT_KEYS.grain]: next ?? null })}
                    options={(catalogue.data?.granularities ?? []).map((item) => ({
                      value: item,
                      label: item,
                    }))}
                  />
                </Space.Compact>
              </Field>

              <Field label="Then by" hint="A second grouping — a stack, a nest, a heatmap's columns.">
                <Select
                  aria-label="Then by"
                  style={{ width: "100%" }}
                  allowClear
                  value={draft.stack || undefined}
                  placeholder="Nothing"
                  onChange={(next: string | undefined) => set({ [DRAFT_KEYS.stack]: next ?? null })}
                  options={groupings
                    .filter((item) => item.name !== draft.group && item.kind !== "datetime")
                    .map((item) => ({ value: item.name, label: item.label }))}
                />
              </Field>

              <Field label="Measure">
                <Space.Compact style={{ width: "100%" }}>
                  <Select
                    aria-label="Aggregation"
                    style={{ width: "40%" }}
                    value={draft.aggregation}
                    onChange={(next) =>
                      set({
                        [DRAFT_KEYS.aggregation]: next,
                        [DRAFT_KEYS.measure]: next === "count" ? null : draft.measure,
                      })
                    }
                    options={(catalogue.data?.aggregations ?? []).map((item) => ({
                      value: item.key,
                      label: item.label,
                    }))}
                  />
                  <Select
                    aria-label="Measured column"
                    style={{ width: "60%" }}
                    value={draft.measure || undefined}
                    placeholder={draft.aggregation === "count" ? "rows" : "Pick a column"}
                    disabled={draft.aggregation === "count"}
                    onChange={(next) => set({ [DRAFT_KEYS.measure]: next })}
                    options={columns.map((item) => ({ value: item.name, label: item.label }))}
                  />
                </Space.Compact>
              </Field>

              <Field
                label="Against"
                hint="A second measure, for a scatter. It becomes the vertical axis."
              >
                <Space.Compact style={{ width: "100%" }}>
                  <Select
                    aria-label="Second aggregation"
                    style={{ width: "40%" }}
                    allowClear
                    value={draft.aggregation2 || undefined}
                    placeholder="Nothing"
                    onChange={(next: string | undefined) =>
                      set({
                        [DRAFT_KEYS.aggregation2]: next ?? null,
                        [DRAFT_KEYS.measure2]: next && next !== "count" ? draft.measure2 : null,
                      })
                    }
                    options={(catalogue.data?.aggregations ?? []).map((item) => ({
                      value: item.key,
                      label: item.label,
                    }))}
                  />
                  <Select
                    aria-label="Second measured column"
                    style={{ width: "60%" }}
                    value={draft.measure2 || undefined}
                    placeholder={draft.aggregation2 ? "Pick a column" : "—"}
                    disabled={!draft.aggregation2 || draft.aggregation2 === "count"}
                    onChange={(next) => set({ [DRAFT_KEYS.measure2]: next })}
                    options={columns.map((item) => ({ value: item.name, label: item.label }))}
                  />
                </Space.Compact>
              </Field>

              <Field label="Period">
                <Select
                  aria-label="Period"
                  style={{ width: "100%" }}
                  value={draft.period}
                  onChange={(next) => set({ [DRAFT_KEYS.period]: next })}
                  options={[
                    ...(catalogue.data?.periods ?? []).map((item) => ({
                      value: item.key,
                      label: item.label,
                    })),
                    { value: "all_time", label: "All time" },
                  ]}
                />
              </Field>
            </Space>
          </Card>

          <Card size="small" title="Save it" className="nu-block">
            <Form
              form={form}
              layout="vertical"
              initialValues={{
                name: stored?.name ?? "",
                description: stored?.description ?? "",
                scope: stored?.scope ?? "PRIVATE",
                is_favorite: stored?.is_favorite ?? false,
                member_ids: stored?.members.map((member) => member.id) ?? [],
              }}
              onFinish={(values: {
                name: string;
                description?: string;
                scope: ReportScope;
                member_ids?: string[];
                is_favorite?: boolean;
              }) => save.mutate(values)}
            >
              <Form.Item
                name="name"
                label="Name"
                rules={[{ required: true, message: "Give it a name people will recognise" }]}
              >
                <Input placeholder="Revenue by channel" />
              </Form.Item>
              <Form.Item name="description" label="What it shows">
                <Input.TextArea rows={2} placeholder="Optional" />
              </Form.Item>
              <Form.Item name="scope" label="Who can see it">
                <Segmented
                  options={[
                    { value: "PRIVATE", label: "Only me" },
                    { value: "SHARED", label: "Named people" },
                    { value: "PUBLIC", label: "Everyone" },
                  ]}
                />
              </Form.Item>
              <Form.Item
                noStyle
                shouldUpdate={(
                  before: { scope?: ReportScope },
                  after: { scope?: ReportScope },
                ) => before.scope !== after.scope}
              >
                {({ getFieldValue }) =>
                  (getFieldValue("scope") as ReportScope) === "SHARED" ? (
                    <Form.Item name="member_ids" label="Shared with">
                      <MemberPicker placeholder="Search colleagues" />
                    </Form.Item>
                  ) : null
                }
              </Form.Item>
              <Form.Item name="is_favorite" label="Favourite" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                htmlType="submit"
                loading={save.isPending}
                disabled={!draftIsRunnable(draft) || Boolean(blocked)}
                data-testid="save-chart"
              >
                {editingId ? "Save" : "Create"}
              </Button>
              {blocked && (
                <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
                  {chosen?.label} {blocked} — it would be saved as a picture that cannot be drawn.
                </Text>
              )}
            </Form>
          </Card>
        </Col>

        <Col xs={24} xl={15}>
          {/* The gallery: every kind, drawn from the reader's own numbers, and
              the ones this question cannot feed refused with the reason. */}
          <Card size="small" title="The picture" data-testid="chart-gallery">
            {!draftIsRunnable(draft) ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Pick a measure and the pictures will draw themselves"
              />
            ) : (
              <div className="nu-gallery">
                {CHART_SHAPES.map((shape) => (
                  <Thumbnail
                    key={shape.kind}
                    shape={shape}
                    missing={missingFor(shape, shapeDraft)}
                    chosen={shape.kind === draft.chart}
                    panel={panelFor(preview.data, shape.kind)}
                    onChoose={() => set({ [DRAFT_KEYS.chart]: shape.kind })}
                  />
                ))}
              </div>
            )}
          </Card>

          {/* The chosen picture at full size, with the chrome every chart in
              the product has: read it as a table, take the numbers away. */}
          <div className="nu-block" data-testid="chart-preview">
            <ChartCard
              id="chart-builder"
              panel={blocked ? undefined : panel}
              height={300}
              loading={preview.isFetching && !preview.data}
            />
          </div>

          {/* And the same chart in both appearances, because a chart checked
              only in the one its author happens to use is a chart nobody
              checked in the other — and half the readers are in the other. */}
          <Card size="small" title="In both themes" className="nu-block" data-testid="chart-themes">
            <Row gutter={[12, 12]}>
              {(["light", "dark"] as const).map((mode) => (
                <Col xs={24} md={12} key={mode}>
                  <ChartPreview
                    panel={blocked ? undefined : panel}
                    mode={mode}
                    height={200}
                    label={mode === "light" ? "Light" : "Dark"}
                  />
                </Col>
              ))}
            </Row>
          </Card>

          {preview.error instanceof ApiError && (
            <Alert
              className="nu-block"
              type="error"
              showIcon
              message={preview.error.message}
              description={
                <Text code copyable={{ text: preview.error.correlationId }}>
                  {preview.error.correlationId}
                </Text>
              }
            />
          )}
        </Col>
      </Row>
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
  panel,
  onChoose,
}: {
  shape: ChartShape;
  missing: string | null;
  chosen: boolean;
  panel: ReturnType<typeof panelFor>;
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
          {missing ? (
            <span className="nu-gallery-missing">{missing}</span>
          ) : (
            <ChartPreview panel={panel} height={104} compact />
          )}
        </span>
        <span className="nu-gallery-label">{shape.label}</span>
      </button>
    </Tooltip>
  );
}

/** A labelled control with an optional line of guidance. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Text strong className="nu-field-label">
        {label}
      </Text>
      {children}
      {hint && (
        <Text type="secondary" style={{ display: "block", marginTop: 4, fontSize: 12 }}>
          {hint}
        </Text>
      )}
    </div>
  );
}
