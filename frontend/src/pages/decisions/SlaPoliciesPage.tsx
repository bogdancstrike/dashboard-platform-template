import "@/styles/decisions.css";

import {
  Alert, App, Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Select, Skeleton, Space,
  Switch, TimePicker, Tooltip, Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  slaApi, target, type BusinessCalendar, type Escalation, type Priority, type SlaCatalogue, type SlaPolicy,
} from "@/api/sla";
import { URL_OVERLAY } from "@/app/history";
import { useUrlOverlay } from "@/app/useUrlOverlay";
import { usePageCommands } from "@/commands/CommandContext";
import { TdIcon } from "@/components/decisions/TdIcon";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { humanStatus } from "@/components/StatusTag";
import { errorText } from "@/lib/errors";

const { Text } = Typography;
const PRIORITIES: Priority[] = ["CRITICAL", "HIGH", "NORMAL", "LOW"];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const ACTION_LABEL: Record<string, string> = { NOTIFY: "Notify", ASSIGN: "Assign to", RAISE_PRIORITY: "Raise priority" };
const TARGET_LABEL: Record<string, string> = { assignee: "the assignee", manager: "the assignee's manager", user: "a person" };

function words(value: string): string {
  return humanStatus(value);
}

/**
 * SLA policies: which tickets, what targets, whose hours, what happens when a
 * ticket is running late. Saving any of it recomputes every ticket's clock,
 * so the ticket pages and every report agree the moment it is saved.
 */
export default function SlaPoliciesPage() {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "calendars" ? "calendars" : "policies";
  const policyOverlay = useUrlOverlay("policy");
  const [calendar, setCalendar] = useState<Partial<BusinessCalendar> | null>(null);

  const overview = useQuery({ queryKey: ["sla", "overview"], queryFn: ({ signal }) => slaApi.overview(signal) });
  const catalogue = useQuery({ queryKey: ["sla", "catalogue"], queryFn: ({ signal }) => slaApi.catalogue(signal), staleTime: 300_000 });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["sla"] });
    void client.invalidateQueries({ queryKey: ["record"] });
  };
  const apply = useMutation({
    mutationFn: slaApi.apply,
    onSuccess: (result) => { refresh(); message.success(`${result.tickets} tickets recomputed, ${result.escalations.fired} escalations fired`); },
    onError: (error) => message.error(errorText(error, { action: "apply the policies" })),
  });
  const reorder = useMutation({
    mutationFn: slaApi.reorder,
    onSuccess: (next) => { client.setQueryData(["sla", "overview"], next); refresh(); },
    onError: (error) => message.error(errorText(error, { action: "reorder policies" })),
  });
  const toggle = useMutation({
    mutationFn: (policy: SlaPolicy) => slaApi.update(policy.id, { active: !policy.active }),
    onSuccess: refresh,
    onError: (error) => message.error(errorText(error, { action: "change this policy" })),
  });

  const canManage = Boolean(overview.data?.can_manage);
  usePageCommands("sla", canManage ? [
    { id: "sla.new", label: "New SLA policy", run: () => policyOverlay.open("new") },
    { id: "sla.apply", label: "Recompute ticket SLAs now", run: () => apply.mutate() },
  ] : []);

  if (overview.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (overview.isError || !overview.data) {
    return <Alert type="error" showIcon message={errorText(overview.error, { fallback: "The policies could not be read." })} />;
  }
  const data = overview.data;
  const covered = data.items.reduce((sum, item) => sum + item.covered_open, 0);
  const breached = data.items.reduce((sum, item) => sum + item.breached_open, 0);
  const move = (index: number, delta: number) => {
    const ids = data.items.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    reorder.mutate(ids);
  };

  return (
    <div className="nx-td" data-testid="sla-page">
      <PageHeader
        title={<>SLA <em>policies</em></>}
        subtitle={`${data.items.length} policies · ${covered} open tickets covered · ${breached} breached · ${data.uncovered_open} without a policy`}
        actions={canManage ? (
          <Space wrap>
            <Button icon={<TdIcon name="clock" />} loading={apply.isPending} onClick={() => apply.mutate()}>Apply now</Button>
            <Button type="primary" icon={<NxIcon name="plus" />} onClick={() => (tab === "calendars" ? setCalendar({}) : policyOverlay.open("new"))} data-testid="sla-new">
              {tab === "calendars" ? "New calendar" : "New policy"}
            </Button>
          </Space>
        ) : undefined}
      />
      <div className="nx-td-chips" role="tablist" aria-label="SLA views">
        {(["policies", "calendars"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`nx-td-chip${tab === key ? " is-on" : ""}`}
            onClick={() => setParams(key === "policies" ? {} : { tab: key })}
          >
            {key === "policies" ? "Policies" : "Business calendars"}
            <b>{key === "policies" ? data.items.length : data.calendars.length}</b>
          </button>
        ))}
      </div>

      {tab === "policies" ? (
        <>
          <Text type="secondary">The first active policy whose conditions match a ticket sets its clock. Order matters — put the narrow ones first.</Text>
          {data.items.length === 0 && <div className="nx-td-empty">No policies — tickets keep whatever deadline they were given.</div>}
          {data.items.map((policy, index) => (
            <Card key={policy.id} className="nx-td-policy" data-testid="sla-policy">
              <div className="nx-td-policy">
                <div className="nx-td-policy-head">
                  <span className="nx-td-policy-rank">{index + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 className="nx-td-policy-title">{policy.name}</h3>
                    <Text type="secondary">{policy.description}</Text>
                  </div>
                  <Space wrap>
                    <Switch checked={policy.active} disabled={!canManage} onChange={() => toggle.mutate(policy)} aria-label={`${policy.name} active`} />
                    {canManage && (
                      <>
                        <Tooltip title="Evaluate earlier"><Button disabled={index === 0} onClick={() => move(index, -1)} icon={<TdIcon name="up" />} aria-label="Move up" /></Tooltip>
                        <Tooltip title="Evaluate later"><Button disabled={index === data.items.length - 1} onClick={() => move(index, 1)} icon={<TdIcon name="up" style={{ transform: "rotate(180deg)" }} />} aria-label="Move down" /></Tooltip>
                        <Button onClick={() => policyOverlay.open(policy.id)} data-testid="sla-edit">Edit</Button>
                      </>
                    )}
                  </Space>
                </div>
                <Space size={6} wrap>
                  {conditionPills(policy, catalogue.data)}
                  <span className="nx-td-pilltag nx-td-pilltag--plain"><TdIcon name="clock" size={12} /> {policy.calendar_name ?? "Every minute"}</span>
                  {policy.pause_statuses.length > 0 && <span className="nx-td-pilltag nx-td-pilltag--plain">Paused while {policy.pause_statuses.map(words).join(", ").toLowerCase()}</span>}
                </Space>
                <div className="nx-td-targets">
                  {PRIORITIES.map((priority) => (
                    <div key={priority} className="nx-td-target">
                      <small>{words(priority)}</small>
                      <div><Text type="secondary">Answer </Text><b>{target(policy.targets[priority]?.first_response)}</b></div>
                      <div><Text type="secondary">Resolve </Text><b>{target(policy.targets[priority]?.resolution)}</b></div>
                    </div>
                  ))}
                </div>
                <div className="nx-td-bar">
                  <div className="nx-td-steps nx-td-grow">
                    {policy.escalations.map((step, i) => (
                      <span key={i} className={`nx-td-pilltag ${step.at_percent >= 100 ? "nx-td-pilltag--bad" : "nx-td-pilltag--warn"}`}>
                        {step.at_percent}% → {ACTION_LABEL[step.action]}{step.target ? ` ${TARGET_LABEL[step.target]}` : ""}
                      </span>
                    ))}
                    {policy.escalations.length === 0 && <span className="nx-td-faint">No escalation steps</span>}
                  </div>
                  <span className="nx-td-faint">{policy.covered_open} open · <b style={{ color: policy.breached_open ? "var(--nu-bad)" : undefined }}>{policy.breached_open} breached</b></span>
                </div>
              </div>
            </Card>
          ))}
        </>
      ) : (
        <div className="nx-td-list">
          {data.calendars.map((cal) => (
            <Card key={cal.id} data-testid="sla-calendar">
              <div className="nx-td-policy">
                <div className="nx-td-policy-head">
                  <span className="nx-td-policy-rank"><TdIcon name="clock" size={16} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 className="nx-td-policy-title">{cal.name}</h3>
                    <Text type="secondary">{cal.timezone} · {Math.round(cal.weekly_minutes / 60)} working hours a week · {cal.holidays.length} holidays · used by {cal.used_by}</Text>
                  </div>
                  {canManage && (
                    <Space>
                      <Button onClick={() => setCalendar(cal)}>Edit</Button>
                      <Popconfirm title="Remove this calendar?" onConfirm={() => slaApi.removeCalendar(cal.id).then(refresh).catch((error) => message.error(errorText(error)))}>
                        <Button danger disabled={cal.used_by > 0}>Remove</Button>
                      </Popconfirm>
                    </Space>
                  )}
                </div>
                <div className="nx-td-week7">
                  {DAYS.map((day) => {
                    const spans = cal.hours[day] ?? [];
                    return (
                      <span key={day} className={spans.length ? "is-open" : undefined} title={spans.map((s) => s.join("–")).join(", ") || "Closed"}>
                        {day.slice(0, 2)} {spans.length ? spans.map((s) => (s[0] === "00:00" && s[1] === "00:00" ? "24h" : `${s[0]}–${s[1]}`)).join(" ") : "—"}
                      </span>
                    );
                  })}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {catalogue.data && (
        <PolicyDrawer
          id={policyOverlay.value}
          onClose={policyOverlay.close}
          policies={data.items}
          calendars={data.calendars}
          catalogue={catalogue.data}
          onSaved={refresh}
        />
      )}
      {catalogue.data && (
        <CalendarModal calendar={calendar} catalogue={catalogue.data} onClose={() => setCalendar(null)} onSaved={refresh} />
      )}
    </div>
  );
}

function conditionPills(policy: SlaPolicy, catalogue?: SlaCatalogue) {
  const c = policy.conditions;
  const pills: string[] = [];
  if (c.segments?.length) pills.push(`Segment: ${c.segments.map(words).join(", ")}`);
  if (c.categories?.length) pills.push(`Type: ${c.categories.map(words).join(", ")}`);
  if (c.channels?.length) pills.push(`Channel: ${c.channels.map(words).join(", ")}`);
  if (c.customer_ids?.length) {
    const names = c.customer_ids.map((id) => catalogue?.customers.find((item) => item.id === id)?.name ?? "a customer");
    pills.push(`Customer: ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}`);
  }
  if (pills.length === 0) pills.push("Every ticket");
  return pills.map((text) => <span key={text} className="nx-td-pilltag nx-td-pilltag--acc nx-td-pilltag--plain">{text}</span>);
}

interface PolicyForm {
  name: string;
  description: string;
  active: boolean;
  segments: string[];
  categories: string[];
  channels: string[];
  customer_ids: string[];
  calendar_id: string;
  pause_statuses: string[];
  targets: Record<Priority, { first_response?: number; resolution?: number }>;
  escalations: Escalation[];
}

function PolicyDrawer({
  id, onClose, policies, calendars, catalogue, onSaved,
}: {
  id: string | null;
  onClose: () => void;
  policies: SlaPolicy[];
  calendars: BusinessCalendar[];
  catalogue: SlaCatalogue;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<PolicyForm>();
  const policy = id && id !== "new" ? policies.find((item) => item.id === id) : undefined;

  // Initial values rather than an effect: a drawer opened straight from the
  // address mounts its form in the same pass, before an effect could fill it.
  const initial = useMemo((): PolicyForm => {
    const hoursOf = (minutes?: number) => (minutes ? Math.round((minutes / 60) * 100) / 100 : undefined);
    return {
      name: policy?.name ?? "",
      description: policy?.description ?? "",
      active: policy?.active ?? true,
      segments: policy?.conditions.segments ?? [],
      categories: policy?.conditions.categories ?? [],
      channels: policy?.conditions.channels ?? [],
      customer_ids: policy?.conditions.customer_ids ?? [],
      calendar_id: policy?.calendar_id ?? calendars.find((cal) => cal.is_default)?.id ?? "",
      pause_statuses: policy?.pause_statuses ?? ["WAITING_CUSTOMER"],
      targets: Object.fromEntries(PRIORITIES.map((priority) => [priority, {
        first_response: hoursOf(policy?.targets[priority]?.first_response),
        resolution: hoursOf(policy?.targets[priority]?.resolution),
      }])) as PolicyForm["targets"],
      escalations: policy?.escalations ?? [{ at_percent: 75, action: "NOTIFY", target: "assignee" }],
    };
  }, [policy, calendars]);

  const save = useMutation({
    mutationFn: (values: PolicyForm) => {
      const toMinutes = (value?: number) => (value ? Math.round(value * 60) : undefined);
      const body: Partial<SlaPolicy> = {
        name: values.name,
        description: values.description,
        active: values.active,
        conditions: { segments: values.segments, categories: values.categories, channels: values.channels, customer_ids: values.customer_ids },
        calendar_id: values.calendar_id || null,
        pause_statuses: values.pause_statuses,
        targets: Object.fromEntries(PRIORITIES.map((priority) => [priority, {
          first_response: toMinutes(values.targets[priority]?.first_response),
          resolution: toMinutes(values.targets[priority]?.resolution),
        }])),
        escalations: values.escalations,
      };
      return policy ? slaApi.update(policy.id, body) : slaApi.create(body);
    },
    onSuccess: () => { onSaved(); message.success("Policy saved — every ticket's clock was recomputed"); onClose(); },
    onError: (error) => message.error(errorText(error, { action: "save this policy" })),
  });
  const remove = useMutation({
    mutationFn: () => slaApi.remove(policy!.id),
    onSuccess: () => { onSaved(); message.success("Policy removed"); onClose(); },
    onError: (error) => message.error(errorText(error, { action: "remove this policy" })),
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

function CalendarModal({
  calendar, catalogue, onClose, onSaved,
}: {
  calendar: Partial<BusinessCalendar> | null;
  catalogue: SlaCatalogue;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [name, setName] = useState("");
  const [zone, setZone] = useState("UTC");
  const [hours, setHours] = useState<Record<string, [Dayjs, Dayjs] | null>>({});
  const [holidays, setHolidays] = useState<{ date: string; name: string }[]>([]);
  useEffect(() => {
    if (!calendar) return;
    setName(calendar.name ?? "");
    setZone(calendar.timezone ?? "Europe/Berlin");
    const source = calendar.hours ?? Object.fromEntries(DAYS.slice(0, 5).map((day) => [day, [["09:00", "17:00"]]]));
    setHours(Object.fromEntries(DAYS.map((day) => {
      const spans = source[day] ?? [];
      if (!spans.length) return [day, null];
      const first = spans[0]!;
      const last = spans[spans.length - 1]!;
      return [day, [dayjs(`2000-01-01T${first[0]}`), dayjs(`2000-01-01T${last[1] === "00:00" ? "23:59" : last[1]}`)]];
    })));
    setHolidays(calendar.holidays ?? []);
  }, [calendar]);
  const save = useMutation({
    mutationFn: () => {
      const body: Partial<BusinessCalendar> = {
        name,
        timezone: zone,
        hours: Object.fromEntries(DAYS.map((day) => {
          const span = hours[day];
          if (!span) return [day, []];
          const end = span[1].format("HH:mm");
          return [day, [[span[0].format("HH:mm"), end === "23:59" ? "00:00" : end]]];
        })),
        holidays,
      };
      return calendar?.id ? slaApi.updateCalendar(calendar.id, body) : slaApi.createCalendar(body);
    },
    onSuccess: () => { onSaved(); message.success("Calendar saved"); onClose(); },
    onError: (error) => message.error(errorText(error, { action: "save this calendar" })),
  });
  return (
    <Modal open={Boolean(calendar)} title={calendar?.id ? "Edit business calendar" : "New business calendar"} onCancel={onClose} onOk={() => save.mutate()} confirmLoading={save.isPending} width={560} destroyOnHidden>
      <Space direction="vertical" style={{ width: "100%" }} size={12}>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" aria-label="Calendar name" />
        <Select showSearch value={zone} onChange={setZone} options={catalogue.timezones.map((tz) => ({ value: tz, label: tz }))} aria-label="Time zone" />
        {DAYS.map((day) => (
          <div key={day} className="nx-td-hours">
            <Switch
              checked={Boolean(hours[day])}
              onChange={(on) => setHours((current) => ({ ...current, [day]: on ? [dayjs("2000-01-01T09:00"), dayjs("2000-01-01T17:00")] : null }))}
              aria-label={`${day} open`}
              checkedChildren={day.slice(0, 2)}
              unCheckedChildren={day.slice(0, 2)}
            />
            {hours[day] ? (
              <TimePicker.RangePicker format="HH:mm" minuteStep={15} value={hours[day]} allowClear={false}
                onChange={(value) => value && value[0] && value[1] && setHours((current) => ({ ...current, [day]: [value[0]!, value[1]!] }))} />
            ) : <Text type="secondary">Closed</Text>}
          </div>
        ))}
        <p className="nx-td-section">Holidays</p>
        {holidays.map((holiday, index) => (
          <Space key={`${holiday.date}-${index}`}>
            <DatePicker value={dayjs(holiday.date)} allowClear={false} onChange={(value) => value && setHolidays((list) => list.map((h, i) => (i === index ? { ...h, date: value.format("YYYY-MM-DD") } : h)))} />
            <Input value={holiday.name} onChange={(event) => setHolidays((list) => list.map((h, i) => (i === index ? { ...h, name: event.target.value } : h)))} aria-label="Holiday name" />
            <Button type="text" icon={<TdIcon name="x" />} aria-label="Remove holiday" onClick={() => setHolidays((list) => list.filter((_, i) => i !== index))} />
          </Space>
        ))}
        <Button icon={<NxIcon name="plus" />} onClick={() => setHolidays((list) => [...list, { date: dayjs().format("YYYY-MM-DD"), name: "Holiday" }])}>Add a holiday</Button>
      </Space>
    </Modal>
  );
}
