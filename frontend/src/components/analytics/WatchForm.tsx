/**
 * Define a metric watch (§22): dataset, measure, filters and granularity;
 * detection method, sensitivity and direction; who is told and how. The
 * chart underneath previews what the detector would flag in the last thirty
 * buckets with these settings, before anything is saved.
 */
import "@/styles/analytics.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Checkbox, Drawer, Form, Input, InputNumber, Segmented, Select, Skeleton } from "antd";
import { useEffect, useMemo } from "react";

import { URL_OVERLAY } from "@/app/history";
import { alertsApi, type MetricWatch, type WatchInput } from "@/api/recordsAnalytics";
import { PeopleField } from "./parts";
import { humanStatus } from "@/components/StatusTag";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { errorText, errorToast } from "@/lib/errors";

import { TrendChart } from "./TrendChart";
import { queryKeys } from "@/lib/queryKeys";
import { PanelHeader } from "@/components/layout/PanelHeader";

type Values = Required<Pick<WatchInput, "name" | "dataset" | "measure" | "granularity" | "method" | "sensitivity" | "direction" | "window" | "channels">> & {
  description?: string;
  measure_field?: string | null;
  date_field?: string | null;
  filter_values: Record<string, string | undefined>;
  recipient_ids: string[];
};

export function WatchForm({
  open,
  onClose,
  watch,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  watch?: MetricWatch;
  onSaved?: (saved: MetricWatch) => void;
}) {
  const [form] = Form.useForm<Values>();
  // Fourteen answers in a drawer that closes on a click outside it (§74).
  const { touch, settled, requestClose } = useDiscardGuard({ close: onClose, what: "watch" });
  const client = useQueryClient();
  const { message } = App.useApp();
  const catalogue = useQuery({ queryKey: queryKeys.alertsCatalogue(), queryFn: ({ signal }) => alertsApi.catalogue(signal), enabled: open });
  const values = Form.useWatch([], form) as Values | undefined;
  const dataset = catalogue.data?.datasets.find((d) => d.key === values?.dataset);

  useEffect(() => {
    if (!open) return;
    if (watch) {
      form.setFieldsValue({
        ...watch,
        description: watch.description ?? undefined,
        filter_values: Object.fromEntries(Object.entries(watch.filters).map(([k, v]) => [k, String(v)])),
        recipient_ids: watch.recipient_ids,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        dataset: "ticket", measure: "count", granularity: "day", method: "zscore", sensitivity: "medium",
        direction: "both", window: 14, channels: ["in_app"], filter_values: {}, recipient_ids: [],
      });
    }
  }, [open, watch, form]);

  const draft = useMemo<WatchInput | null>(() => {
    if (!values?.dataset) return null;
    return {
      dataset: values.dataset,
      measure: values.measure,
      measure_field: values.measure === "count" ? null : values.measure_field ?? null,
      date_field: values.date_field ?? null,
      granularity: values.granularity,
      method: values.method,
      sensitivity: values.sensitivity,
      direction: values.direction,
      window: values.window,
      filters: Object.fromEntries(Object.entries(values.filter_values ?? {}).filter(([, v]) => v)),
    };
  }, [values]);
  const debounced = useDebouncedValue(draft, 400);
  const ready = Boolean(debounced && (debounced.measure === "count" || debounced.measure_field));
  const preview = useQuery({
    queryKey: queryKeys.alertsPreview(debounced),
    queryFn: ({ signal }) => alertsApi.preview(debounced!, signal),
    enabled: open && ready,
  });

  const save = useMutation({
    mutationFn: (input: Values) => {
      const body: WatchInput = {
        ...draft!,
        name: input.name,
        description: input.description || null,
        channels: input.channels,
        recipient_ids: input.recipient_ids ?? [],
      };
      return watch ? alertsApi.update(watch.id, body) : alertsApi.create(body);
    },
    onSuccess: (saved) => {
      settled();
      void message.success(watch ? "Watch saved." : `Watching “${saved.name}”.`);
      void client.invalidateQueries({ queryKey: queryKeys.alerts() });
      // A page that moves on to the saved record replaces the overlay's
      // history entry itself; closing first would send "back" after it.
      if (onSaved) onSaved(saved);
      else onClose();
    },
    onError: errorToast(message, { action: "manage alerts" }),
  });

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      title={watch ? `Edit “${watch.name}”` : "Watch a metric"}
      width="min(560px, 100vw)"
      rootClassName={URL_OVERLAY}
      forceRender
      extra={
        <Button type="primary" loading={save.isPending} onClick={() => form.submit()} data-testid="watch-save">
          {watch ? "Save" : "Start watching"}
        </Button>
      }
    >
      {catalogue.isLoading ? (
        <Skeleton active />
      ) : (
        <Form form={form} layout="vertical" onValuesChange={touch} onFinish={(input) => save.mutate(input)} requiredMark="optional">
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Name the watch" }]}>
            <Input maxLength={160} placeholder="New tickets per day" data-testid="watch-name" />
          </Form.Item>
          <Form.Item name="description" label="What it is for">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Form.Item name="dataset" label="Dataset" style={{ flex: 1, minWidth: 160 }}>
              <Select
                options={catalogue.data?.datasets.map((d) => ({ value: d.key, label: d.label }))}
                onChange={() => form.setFieldsValue({ measure_field: null, date_field: null, filter_values: {} })}
                data-testid="watch-dataset"
              />
            </Form.Item>
            <Form.Item name="measure" label="Measure" style={{ width: 140 }}>
              <Select options={[{ value: "count", label: "Count" }, { value: "sum", label: "Sum of" }, { value: "avg", label: "Average of" }]} />
            </Form.Item>
            {values?.measure !== "count" && (
              <Form.Item name="measure_field" label="Field" style={{ width: 170 }} rules={[{ required: true, message: "Pick a number" }]}>
                <Select options={dataset?.numbers.map((n) => ({ value: n.name, label: n.label }))} />
              </Form.Item>
            )}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Form.Item name="date_field" label="Over" style={{ flex: 1, minWidth: 160 }}>
              <Select allowClear placeholder={dataset ? `${dataset.dates.find((d) => d.name === dataset.default_date)?.label ?? "Created"} (default)` : ""}
                options={dataset?.dates.map((d) => ({ value: d.name, label: d.label }))} />
            </Form.Item>
            <Form.Item name="granularity" label="Per">
              <Segmented options={[{ value: "hour", label: "Hour" }, { value: "day", label: "Day" }, { value: "week", label: "Week" }]} />
            </Form.Item>
          </div>
          {dataset && dataset.filters.length > 0 && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {dataset.filters.slice(0, 4).map((filter) => (
                <Form.Item key={filter.name} name={["filter_values", filter.name]} label={filter.label} style={{ flex: 1, minWidth: 140 }}>
                  <Select
                    allowClear
                    placeholder="Any"
                    options={(filter.kind === "bool" ? ["true", "false"] : filter.choices).map((c) => ({ value: c, label: humanStatus(c) }))}
                  />
                </Form.Item>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Form.Item name="method" label="Detection" style={{ flex: 1, minWidth: 200 }}
              extra={values?.method === "seasonal" ? "Compared with the same slot in the last four cycles." : "Compared with the rolling window before it."}>
              <Segmented options={[{ value: "zscore", label: "Rolling" }, { value: "seasonal", label: "Seasonal" }]} />
            </Form.Item>
            {values?.method !== "seasonal" && (
              <Form.Item name="window" label="Window (points)" style={{ width: 140 }}>
                <InputNumber min={3} max={90} style={{ width: "100%" }} />
              </Form.Item>
            )}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Form.Item name="sensitivity" label="Sensitivity">
              <Segmented options={(catalogue.data?.sensitivities ?? []).map((s) => ({ value: s.key, label: `${s.key[0]!.toUpperCase()}${s.key.slice(1)} (z ${s.threshold})` }))} />
            </Form.Item>
            <Form.Item name="direction" label="Tell me about">
              <Segmented options={[{ value: "both", label: "Both" }, { value: "up", label: "Spikes" }, { value: "down", label: "Drops" }]} />
            </Form.Item>
          </div>
          <section className="nx-ra-panel" style={{ padding: 12, marginBottom: 16 }} aria-label="Preview">
            <PanelHeader title="Preview" extra={<span className="nx-ra-sub">{preview.data ? `${preview.data.flagged} point${preview.data.flagged === 1 ? "" : "s"} would be flagged` : ""}</span>} style={{ marginBottom: 4 }} />
            {preview.isError ? (
              <Alert type="warning" showIcon message={errorText(preview.error)} />
            ) : preview.data ? (
              <TrendChart label="Value" height={160} points={preview.data.points.map((p) => ({ ...p, marked: p.unusual }))} />
            ) : !ready ? (
              // Nothing is being fetched until a number is chosen, so a
              // skeleton here would be a spinner that never ends.
              <p className="nx-ra-sub" data-testid="watch-preview-idle">Choose the number to watch to see a preview.</p>
            ) : (
              <Skeleton active paragraph={{ rows: 3 }} title={false} />
            )}
          </section>
          <Form.Item name="channels" label="Notify">
            <Checkbox.Group options={[{ value: "in_app", label: "In-app" }, { value: "email", label: "Email" }]} />
          </Form.Item>
          <Form.Item name="recipient_ids" label="Also tell" extra="You are always told about your own watches.">
            <PeopleField label="Recipients" />
          </Form.Item>
        </Form>
      )}
    </Drawer>
  );
}
