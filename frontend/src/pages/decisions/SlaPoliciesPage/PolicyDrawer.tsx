import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Drawer, Form, Input, InputNumber, Popconfirm, Select, Space, Switch } from "antd";

import { slaApi, type BusinessCalendar, type SlaCatalogue, type SlaPolicy } from "@/api/sla";
import { URL_OVERLAY } from "@/app/history";
import { TdIcon } from "@/components/icons/TdIcon";
import { NxIcon } from "@/components/NxIcon";
import { errorToast } from "@/lib/errors";

import { ACTION_LABEL, PRIORITIES, initialPolicy, policyBody, words, type PolicyForm } from "./slaCopy";

interface PolicyDrawerProps {
  id: string | null;
  onClose: () => void;
  policies: SlaPolicy[];
  calendars: BusinessCalendar[];
  catalogue: SlaCatalogue;
  onSaved: () => void;
}

/** Add or change a policy: the tickets it matches, its targets, hours and escalation steps. */
export function PolicyDrawer({ id, onClose, policies, calendars, catalogue, onSaved }: PolicyDrawerProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<PolicyForm>();
  const policy = id && id !== "new" ? policies.find((item) => item.id === id) : undefined;
  const initial = useMemo(() => initialPolicy(policy, calendars), [policy, calendars]);

  const save = useMutation({
    mutationFn: (values: PolicyForm) => {
      const body = policyBody(values);
      return policy ? slaApi.update(policy.id, body) : slaApi.create(body);
    },
    onSuccess: () => { onSaved(); message.success("Policy saved — every ticket's clock was recomputed"); onClose(); },
    onError: errorToast(message, { action: "save this policy" }),
  });
  const remove = useMutation({
    mutationFn: () => slaApi.remove(policy!.id),
    onSuccess: () => { onSaved(); message.success("Policy removed"); onClose(); },
    onError: errorToast(message, { action: "remove this policy" }),
  });
  const options = (values: string[]) => values.map((value) => ({ value, label: words(value) }));

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      width={620}
      rootClassName={URL_OVERLAY}
      title={policy ? `Edit ${policy.name}` : "New SLA policy"}
      forceRender
      data-testid="sla-drawer"
      extra={policy ? (
        <Popconfirm title="Remove this policy? Tickets fall to the next match." onConfirm={() => remove.mutate()}>
          <Button danger>Remove</Button>
        </Popconfirm>
      ) : undefined}
      footer={<Space><Button onClick={onClose}>Cancel</Button><Button type="primary" loading={save.isPending} onClick={() => form.submit()} data-testid="sla-save">Save policy</Button></Space>}
    >
      <Form key={id ?? "closed"} form={form} initialValues={initial} layout="vertical" onFinish={(values) => save.mutate(values)} requiredMark="optional">
        <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input placeholder="Enterprise support" /></Form.Item>
        <Form.Item name="description" label="Description"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>
        <p className="nx-td-section">Which tickets</p>
        <Form.Item name="segments" label="Customer segment"><Select mode="multiple" allowClear options={options(catalogue.segments)} placeholder="Any segment" /></Form.Item>
        <Form.Item name="categories" label="Ticket type"><Select mode="multiple" allowClear options={options(catalogue.categories)} placeholder="Any type" /></Form.Item>
        <Form.Item name="channels" label="Channel"><Select mode="multiple" allowClear options={options(catalogue.channels)} placeholder="Any channel" /></Form.Item>
        <Form.Item name="customer_ids" label="Specific customers">
          <Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder="Any customer"
            options={catalogue.customers.map((item) => ({ value: item.id, label: `${item.name} · ${words(item.segment)}` }))} />
        </Form.Item>
        <TargetFields />
        <Form.Item name="calendar_id" label="Business hours" style={{ marginTop: 16 }}>
          <Select options={[{ value: "", label: "Every minute (24/7, no holidays)" }, ...calendars.map((cal) => ({ value: cal.id, label: `${cal.name} · ${cal.timezone}` }))]} />
        </Form.Item>
        <Form.Item name="pause_statuses" label="Pause the clock while the ticket is">
          <Select mode="multiple" options={options(catalogue.statuses.filter((s) => !["RESOLVED", "CLOSED"].includes(s)))} />
        </Form.Item>
        <p className="nx-td-section">Escalation steps</p>
        <Form.List name="escalations">
          {(fields, { add, remove: drop }) => (
            <Space direction="vertical" style={{ width: "100%" }}>
              {fields.map((field) => (
                <EscalationRow key={field.key} name={field.name} form={form} onRemove={() => drop(field.name)} />
              ))}
              <Button icon={<NxIcon name="plus" />} onClick={() => add({ at_percent: 100, action: "NOTIFY", target: "manager" })}>Add a step</Button>
            </Space>
          )}
        </Form.List>
      </Form>
    </Drawer>
  );
}

/** First-response and resolution targets per priority, in hours. */
function TargetFields() {
  return (
    <>
      <p className="nx-td-section">Targets, in business hours</p>
      <div className="nx-td-targets" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        {PRIORITIES.map((priority) => (
          <div key={priority} className="nx-td-target">
            <small>{words(priority)}</small>
            <Form.Item name={["targets", priority, "first_response"]} label="First response (h)" style={{ marginBottom: 6 }}>
              <InputNumber min={0.05} step={0.25} style={{ width: "100%" }} aria-label={`${priority} first response hours`} />
            </Form.Item>
            <Form.Item name={["targets", priority, "resolution"]} label="Resolution (h)" style={{ marginBottom: 0 }}>
              <InputNumber min={0.05} step={0.5} style={{ width: "100%" }} aria-label={`${priority} resolution hours`} />
            </Form.Item>
          </div>
        ))}
      </div>
    </>
  );
}

/** One step: at what share of the target, what happens, and to whom. */
function EscalationRow({ name, form, onRemove }: { name: number; form: ReturnType<typeof Form.useForm<PolicyForm>>[0]; onRemove: () => void }) {
  const action = Form.useWatch(["escalations", name, "action"], form) as string | undefined;
  return (
    <Space wrap align="start">
      <Form.Item name={[name, "at_percent"]} rules={[{ required: true }]} style={{ marginBottom: 0 }}>
        <InputNumber min={1} max={500} suffix="%" style={{ width: 110 }} aria-label={`Step ${name + 1}: at percent of target`} />
      </Form.Item>
      <Form.Item name={[name, "action"]} style={{ marginBottom: 0 }}>
        <Select style={{ width: 150 }} aria-label={`Step ${name + 1}: what happens`} options={Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))} />
      </Form.Item>
      {action !== "RAISE_PRIORITY" && (
        <Form.Item name={[name, "target"]} style={{ marginBottom: 0 }}>
          <Select style={{ width: 190 }} aria-label={`Step ${name + 1}: who is told`} options={[{ value: "assignee", label: "the assignee" }, { value: "manager", label: "the assignee's manager" }]} />
        </Form.Item>
      )}
      <Button type="text" aria-label={`Remove step ${name + 1}`} icon={<TdIcon name="x" />} onClick={onRemove} />
    </Space>
  );
}
