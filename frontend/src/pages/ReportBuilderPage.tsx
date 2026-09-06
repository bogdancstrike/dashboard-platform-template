/**
 * `/reports/builder` — compose a question, watch it answer itself (§28, §44).
 *
 * The builder and the preview are the same query. Every control writes into
 * one draft, the draft is sent to the analysis endpoint on every change, and
 * what is saved is exactly what was previewed — there is no "generate" step in
 * which the definition could be reinterpreted.
 *
 * What the reader may pick comes from `/api/analysis/catalog`, which is
 * generated from the resource declarations. So the builder cannot offer a
 * column the compiler will reject, and a field added to a dataset becomes
 * available here with no change to this file.
 *
 * The draft lives in the URL (§69, §72), which is what lets "Save as a report"
 * on the analytics workspace hand its context straight to this page — and what
 * lets a half-built report be pasted to a colleague.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Typography,
} from "antd";
import { SaveOutlined } from "@ant-design/icons";
import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  analysisApi,
  panelFor,
  type AnalysisMeasure,
  type AnalysisRequest,
} from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import { reportsApi, type ReportInput, type ReportScope } from "@/api/reports";
import { ChartCard } from "@/components/ChartCard";
import { PageHeader } from "@/components/PageHeader";
import { PeoplePicker } from "@/components/PeoplePicker";
import { usePageCommands } from "@/commands/CommandContext";

const { Text } = Typography;

/** The kinds this page offers. Every one is drawn by the shared renderer. */
const CHARTS: ChartKind[] = ["bar", "hbar", "line", "area", "pie", "stacked-bar", "treemap"];

export default function ReportBuilderPage() {
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

  // The report being edited, when there is one. Its stored definition seeds
  // the draft, so "Edit" opens the question rather than a blank form.
  const existing = useQuery({
    queryKey: ["report", editingId],
    queryFn: ({ signal }) => reportsApi.get(editingId, signal),
    enabled: Boolean(editingId),
  });

  const datasets = catalogue.data?.datasets ?? [];
  const resourceKey =
    params.get("resource") ?? existing.data?.resource_type ?? datasets[0]?.key ?? "";
  const dataset = datasets.find((item) => item.key === resourceKey);
  const groupBy = params.get("group") ?? existing.data?.dimensions[0]?.field ?? "";
  const granularity = params.get("grain") ?? existing.data?.dimensions[0]?.granularity ?? "";
  const stackBy = params.get("stack") ?? existing.data?.dimensions[1]?.field ?? "";
  const aggregation = params.get("agg") ?? existing.data?.metrics[0]?.aggregation ?? "count";
  const measureField = params.get("measure") ?? existing.data?.metrics[0]?.field ?? "";
  const period = params.get("period") ?? existing.data?.period ?? "last_90_days";
  const chart = (params.get("chart") ?? existing.data?.visualization ?? "bar") as ChartKind;

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

  /** The one definition both the preview and the save are built from. */
  const draft = useMemo(() => {
    const dimensions = [
      ...(groupBy ? [{ field: groupBy, granularity }] : []),
      ...(stackBy ? [{ field: stackBy, granularity: "" }] : []),
    ];
    const metrics: AnalysisMeasure[] =
      aggregation === "count"
        ? [{ aggregation: "count" }]
        : [{ aggregation: aggregation as AnalysisMeasure["aggregation"], field: measureField }];
    return { dimensions, metrics };
  }, [groupBy, granularity, stackBy, aggregation, measureField]);

  const runnable =
    Boolean(dataset) && (aggregation === "count" || Boolean(measureField));

  const preview = useQuery({
    queryKey: ["analysis", "builder", resourceKey, draft, period],
    queryFn: ({ signal }) =>
      analysisApi.run(
        {
          resource_type: resourceKey,
          dimensions: draft.dimensions,
          measures: draft.metrics,
          period,
        } satisfies AnalysisRequest,
        signal,
      ),
    enabled: runnable,
    placeholderData: (previous) => previous,
  });

  const save = useMutation({
    mutationFn: (values: { name: string; description?: string; scope: ReportScope; member_ids?: string[]; is_favorite?: boolean }) => {
      const input: ReportInput = {
        ...values,
        resource_type: resourceKey,
        dimensions: draft.dimensions,
        metrics: draft.metrics,
        period,
        visualization: chart,
      };
      return editingId ? reportsApi.update(editingId, input) : reportsApi.create(input);
    },
    onSuccess: (saved) => {
      message.success(editingId ? `${saved.name} saved` : `${saved.name} created`);
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      navigate(`/reports?report=${saved.id}`);
    },
  });

  usePageCommands("report-builder", [
    {
      id: "builder.save",
      label: "Save this report",
      keywords: "store keep",
      run: () => void form.submit(),
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

  const dimensions = dataset?.dimensions ?? [];
  const measures = dataset?.measures ?? [];

  return (
    <>
      <PageHeader
        title={editingId ? `Edit ${existing.data?.name ?? "report"}` : "Build a report"}
        subtitle="Pick the dataset, how to cut it and how to draw it. The preview is the query that will be saved."
        onBack={() => navigate("/reports")}
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
          <Card size="small" title="The question" data-testid="report-question">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Field label="Dataset">
                <Select
                  aria-label="Dataset"
                  style={{ width: "100%" }}
                  value={resourceKey}
                  onChange={(next) =>
                    set({ resource: next, group: null, stack: null, measure: null, grain: null })
                  }
                  options={datasets.map((item) => ({ value: item.key, label: item.label }))}
                />
              </Field>

              <Field label="Group by" hint="Up to two columns — a series and a stack.">
                <Space.Compact style={{ width: "100%" }}>
                  <Select
                    aria-label="Group by"
                    style={{ width: "60%" }}
                    allowClear
                    value={groupBy || undefined}
                    placeholder="Nothing — one row"
                    onChange={(next: string | undefined) => set({ group: next ?? null, grain: null })}
                    options={dimensions.map((item) => ({ value: item.name, label: item.label }))}
                  />
                  <Select
                    aria-label="Granularity"
                    style={{ width: "40%" }}
                    allowClear
                    value={granularity || undefined}
                    placeholder="Bucket"
                    // Only a date buckets; offering it for an enum would be a
                    // control that produces an error rather than a result.
                    disabled={dimensions.find((item) => item.name === groupBy)?.kind !== "datetime"}
                    onChange={(next: string | undefined) => set({ grain: next ?? null })}
                    options={(catalogue.data?.granularities ?? []).map((item) => ({
                      value: item,
                      label: item,
                    }))}
                  />
                </Space.Compact>
              </Field>

              <Field label="Then by" hint="A second vocabulary, drawn as a stack.">
                <Select
                  aria-label="Then by"
                  style={{ width: "100%" }}
                  allowClear
                  value={stackBy || undefined}
                  placeholder="Nothing"
                  onChange={(next: string | undefined) => set({ stack: next ?? null })}
                  options={dimensions
                    .filter((item) => item.name !== groupBy && item.kind !== "datetime")
                    .map((item) => ({ value: item.name, label: item.label }))}
                />
              </Field>

              <Field label="Measure">
                <Space.Compact style={{ width: "100%" }}>
                  <Select
                    aria-label="Aggregation"
                    style={{ width: "40%" }}
                    value={aggregation}
                    onChange={(next) => set({ agg: next, measure: next === "count" ? null : measureField })}
                    options={(catalogue.data?.aggregations ?? []).map((item) => ({
                      value: item.key,
                      label: item.label,
                    }))}
                  />
                  <Select
                    aria-label="Measured column"
                    style={{ width: "60%" }}
                    value={measureField || undefined}
                    placeholder={aggregation === "count" ? "rows" : "Pick a column"}
                    disabled={aggregation === "count"}
                    onChange={(next) => set({ measure: next })}
                    options={measures.map((item) => ({ value: item.name, label: item.label }))}
                  />
                </Space.Compact>
              </Field>

              <Field label="Period">
                <Select
                  aria-label="Period"
                  style={{ width: "100%" }}
                  value={period}
                  onChange={(next) => set({ period: next })}
                  options={[
                    ...(catalogue.data?.periods ?? []).map((item) => ({
                      value: item.key,
                      label: item.label,
                    })),
                    { value: "all_time", label: "All time" },
                  ]}
                />
              </Field>

              <Field label="Draw it as">
                <Segmented
                  aria-label="Visualization"
                  value={chart}
                  onChange={(next) => set({ chart: String(next) })}
                  options={CHARTS.map((item) => ({ value: item, label: item }))}
                />
              </Field>
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={15}>
          <ChartCard
            id="report-preview"
            height={340}
            loading={preview.isLoading}
            panel={panelFor(preview.data, chart, undefined, preview.data?.description)}
          />

          {!runnable && (
            <Alert
              className="nu-block"
              type="info"
              showIcon
              message="Pick a column to measure"
              description="Every aggregation except a row count needs one."
            />
          )}

          {preview.isError && (
            <Alert
              className="nu-block"
              type="error"
              showIcon
              message={
                preview.error instanceof ApiError
                  ? preview.error.message
                  : "That question could not be answered."
              }
            />
          )}

          <Card size="small" title="Save it" className="nu-block">
            <Form
              form={form}
              layout="vertical"
              initialValues={{
                name: existing.data?.name ?? "",
                description: existing.data?.description ?? "",
                scope: existing.data?.scope ?? "PRIVATE",
                member_ids: existing.data?.members.map((member) => member.id) ?? [],
                is_favorite: existing.data?.is_favorite ?? false,
              }}
              onFinish={(values: {
                name: string;
                description?: string;
                scope: ReportScope;
                member_ids?: string[];
                is_favorite?: boolean;
              }) => save.mutate(values)}
            >
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="name"
                    label="Name"
                    rules={[{ required: true, message: "A report needs a name" }]}
                  >
                    <Input placeholder="Revenue by channel" aria-label="Name" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="description" label="Description">
                    <Input placeholder="What this answers, and for whom" aria-label="Description" />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <Form.Item name="scope" label="Who can see it">
                    <Select
                      aria-label="Who can see it"
                      options={[
                        { value: "PRIVATE", label: "Private — only me" },
                        { value: "SHARED", label: "Shared — named people" },
                        { value: "PUBLIC", label: "Public — everyone signed in" },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
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
                          <MemberPicker />
                        </Form.Item>
                      ) : null
                    }
                  </Form.Item>
                </Col>
                <Col xs={24} md={4}>
                  <Form.Item name="is_favorite" label="Favourite" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Col>
              </Row>

              <Button
                type="primary"
                icon={<SaveOutlined />}
                htmlType="submit"
                loading={save.isPending}
                disabled={!runnable}
                data-testid="save-report"
              >
                {editingId ? "Save changes" : "Create report"}
              </Button>
            </Form>
          </Card>
        </Col>
      </Row>
    </>
  );
}

/** A labelled control, so the builder reads as a sentence being assembled. */
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
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {hint}
          </Text>
        </div>
      )}
    </div>
  );
}

/** The audience, picked from the directory rather than typed as ids. */
function MemberPicker({
  value,
  onChange,
}: {
  value?: string[];
  onChange?: (value: string[]) => void;
}) {
  return (
    <PeoplePicker
      aria-label="Shared with"
      value={value ?? []}
      onChange={(ids) => onChange?.(ids)}
    />
  );
}
