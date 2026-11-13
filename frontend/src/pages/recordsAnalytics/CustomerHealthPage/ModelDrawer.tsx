import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Form, Input, InputNumber, Skeleton, Slider, Tooltip } from "antd";
import { useEffect } from "react";

import { URL_OVERLAY } from "@/app/history";
import { healthApi, type HealthModel } from "@/api/recordsAnalytics";
import { FailureAlert } from "@/components/FailureAlert";
import { errorToast } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

/** The weights and thresholds — read by anyone, changed by `health.configure`. */
export function ModelDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<HealthModel>();
  const model = useQuery({ queryKey: queryKeys.healthModel(), queryFn: ({ signal }) => healthApi.model(signal), enabled: open });
  const weights = Form.useWatch("weights", form) as HealthModel["weights"] | undefined;
  const total = weights ? Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0) : 0;

  useEffect(() => {
    if (model.data) form.setFieldsValue(model.data);
  }, [model.data, form]);

  const save = useMutation({
    mutationFn: (values: HealthModel) =>
      healthApi.saveModel({ name: values.name, weights: values.weights, thresholds: values.thresholds }),
    onSuccess: (saved) => {
      void message.success(`Model saved — ${saved.recomputed.customers} customers rescored.`);
      void client.invalidateQueries({ queryKey: queryKeys.healthModel() });
      void client.invalidateQueries({ queryKey: queryKeys.healthPortfolio() });
      void client.invalidateQueries({ queryKey: queryKeys.customerHealth() });
      onClose();
    },
    onError: errorToast(message),
  });

  const editable = Boolean(model.data?.can_configure);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Health model"
      width={460}
      rootClassName={URL_OVERLAY}
      extra={
        editable && (
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()} data-testid="health-model-save">
            Save and rescore
          </Button>
        )
      }
    >
      {model.isLoading ? (
        <Skeleton active />
      ) : model.isError ? (
        <FailureAlert error={model.error} />
      ) : (
        <Form form={form} layout="vertical" disabled={!editable} onFinish={(values) => save.mutate(values)}>
          {!editable && <p className="nx-ra-muted">Your role can read the model; changing it needs “Change the customer health model”.</p>}
          <Form.Item name="name" label="Name">
            <Input maxLength={120} />
          </Form.Item>
          <h3 className="nx-ra-sub">Weights <Tooltip title="Relative — they are normalised to 100%"><span>· total {total}</span></Tooltip></h3>
          <div className="nx-ra-weights">
            {model.data?.signals.map((signal) => (
              <Form.Item key={signal.key} name={["weights", signal.key]} label={signal.label} style={{ marginBottom: 0 }}>
                <Slider min={0} max={100} ariaLabelForHandle={`${signal.label} weight`} />
              </Form.Item>
            ))}
          </div>
          <h3 className="nx-ra-sub" style={{ marginTop: 16 }}>Bands</h3>
          <Form.Item name={["thresholds", "bands", "healthy"]} label="Healthy from">
            <InputNumber min={1} max={100} />
          </Form.Item>
          <Form.Item name={["thresholds", "bands", "at_risk"]} label="At risk from (below is critical)">
            <InputNumber min={1} max={100} />
          </Form.Item>
          <h3 className="nx-ra-sub">Tickets — points off per item</h3>
          <Form.Item name={["thresholds", "tickets", "open"]} label="Open ticket"><InputNumber min={1} max={100} /></Form.Item>
          <Form.Item name={["thresholds", "tickets", "escalated"]} label="Escalated ticket"><InputNumber min={1} max={100} /></Form.Item>
          <Form.Item name={["thresholds", "tickets", "breached"]} label="SLA breach (90 days)"><InputNumber min={1} max={100} /></Form.Item>
          <h3 className="nx-ra-sub">Orders, usage and renewal (days)</h3>
          <Form.Item name={["thresholds", "orders", "recency_days"]} label="No order for this long scores 0"><InputNumber min={1} max={3650} /></Form.Item>
          <Form.Item name={["thresholds", "orders", "window_days"]} label="Volume window"><InputNumber min={1} max={3650} /></Form.Item>
          <Form.Item name={["thresholds", "usage", "contact_days"]} label="No contact for this long scores 0"><InputNumber min={1} max={3650} /></Form.Item>
          <Form.Item name={["thresholds", "renewal", "window_days"]} label="Renewal starts to weigh within"><InputNumber min={1} max={3650} /></Form.Item>
        </Form>
      )}
    </Drawer>
  );
}
