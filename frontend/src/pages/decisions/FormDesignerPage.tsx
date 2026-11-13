import "@/styles/decisions.css";

import {
  Alert, App, Button, Card, Input, InputNumber, Pagination, Popconfirm, Segmented, Select, Skeleton, Space, Switch,
  Tooltip, Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  formsApi, type FieldType, type FormDetail, type FormField, type FormInput, type FormSettings, type FormTarget,
} from "@/api/forms";
import { useSmartBack } from "@/app/history";
import { usePageCommands } from "@/commands/CommandContext";
import { FormRenderer } from "@/components/decisions/FormRenderer";
import { TdIcon } from "@/components/icons/TdIcon";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { PeoplePicker } from "@/components/PeoplePicker";
import { asText } from "@/lib/text";
import { errorText, errorToast } from "@/lib/errors";
import { absoluteTime, relativeTime } from "@/lib/time";

import { FORM_STATUS_TONE } from "./FormsPage";
import { EmptyState } from "@/components/EmptyState";
import { FEATURES, useFeature } from "@/settings/features";
import { queryKeys } from "@/lib/queryKeys";

const { Text } = Typography;

export const FIELD_TYPES: { type: FieldType; label: string; hint: string }[] = [
  { type: "text", label: "Short text", hint: "One line" },
  { type: "textarea", label: "Long text", hint: "Paragraphs" },
  { type: "email", label: "Email", hint: "Checked address" },
  { type: "number", label: "Number", hint: "Digits only" },
  { type: "select", label: "Choice", hint: "Pick one" },
  { type: "multiselect", label: "Multiple choice", hint: "Pick several" },
  { type: "date", label: "Date", hint: "Calendar" },
  { type: "file", label: "File upload", hint: "Up to 3 MB" },
  { type: "rating", label: "Rating", hint: "Stars" },
  { type: "heading", label: "Section heading", hint: "Splits the form" },
];
const TYPE_LABEL = Object.fromEntries(FIELD_TYPES.map((item) => [item.type, item.label])) as Record<FieldType, string>;

const BLANK: FormDetail = {
  id: "", name: "New intake form", slug: "", description: "", target: "ticket", status: "DRAFT",
  visibility: "PUBLIC", submission_count: 0, owner: null, public_path: "", updated_at: null, created_at: null,
  field_count: 0, fields: [
    { id: "email", type: "email", label: "Your email", required: true },
    { id: "subject", type: "text", label: "What do you need?", required: true, map_to: "subject" },
    { id: "details", type: "textarea", label: "Details", map_to: "description" },
  ],
  settings: {
    visibility: "PUBLIC", confirmation: "Thank you — we have received your request.", notify_user_ids: [],
    captcha: true, rate_limit_per_hour: 10, defaults: {}, submit_label: "Send",
  },
  targets: [], can_manage: true,
};

export function newField(type: FieldType, existing: FormField[]): FormField {
  let n = existing.length + 1;
  while (existing.some((field) => field.id === `${type}${n}`)) n += 1;
  return {
    id: `${type}${n}`, type, label: TYPE_LABEL[type], required: false,
    ...(type === "select" || type === "multiselect" ? { options: ["Option one", "Option two"] } : {}),
    ...(type === "rating" ? { max: 5 } : {}),
  };
}

/** Move one item in a list to a new position — the drag-and-drop's whole arithmetic. */
export function moved<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(Math.max(0, Math.min(copy.length, to)), 0, item!);
  return copy;
}

/**
 * The form designer: drag fields in from the palette, drag them into order,
 * map each onto a field of the record it creates, set who can answer and what
 * they are told — and read what came in.
 */
export default function FormDesignerPage() {
  const publicFormsOn = useFeature(FEATURES.publicForms);
  const { id = "new" } = useParams();
  const creating = id === "new";
  const navigate = useNavigate();
  const back = useSmartBack();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (["design", "settings", "submissions"].includes(params.get("tab") ?? "") ? params.get("tab") : "design") as
    "design" | "settings" | "submissions";

  const loaded = useQuery({
    queryKey: queryKeys.forms("item", id),
    queryFn: ({ signal }) => formsApi.get(id, signal),
    enabled: !creating,
  });
  const list = useQuery({ queryKey: queryKeys.forms("list"), queryFn: ({ signal }) => formsApi.list(signal), enabled: creating });
  const [draft, setDraft] = useState<FormDetail | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (creating && list.data && !draft) setDraft({ ...BLANK, targets: list.data.targets, can_manage: list.data.can_manage });
    if (!creating && loaded.data) { setDraft(loaded.data); setDirty(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, loaded.data, list.data]);

  const change = (patch: Partial<FormDetail>) => { setDraft((current) => (current ? { ...current, ...patch } : current)); setDirty(true); };
  const changeSettings = (patch: Partial<FormSettings>) =>
    setDraft((current) => { setDirty(true); return current ? { ...current, settings: { ...current.settings, ...patch } } : current; });

  const save = useMutation({
    mutationFn: (status?: FormDetail["status"]) => {
      const body: FormInput = {
        name: draft!.name, slug: draft!.slug || undefined, description: draft!.description, target: draft!.target,
        fields: draft!.fields, settings: draft!.settings, ...(status ? { status } : {}),
      };
      return creating ? formsApi.create(body) : formsApi.update(id, body);
    },
    onSuccess: (saved) => {
      client.setQueryData(queryKeys.forms("item", saved.id), saved);
      void client.invalidateQueries({ queryKey: queryKeys.forms("list") });
      setDraft(saved);
      setDirty(false);
      message.success(saved.status === "PUBLISHED" ? "Saved — the form is live" : "Saved");
      if (creating) navigate(`/admin/forms/${saved.id}`, { replace: true });
    },
    onError: errorToast(message, { action: "save this form" }),
  });
  const remove = useMutation({
    mutationFn: () => formsApi.remove(id),
    onSuccess: () => { void client.invalidateQueries({ queryKey: queryKeys.forms() }); message.success("Form removed"); navigate("/admin/forms", { replace: true }); },
    onError: errorToast(message, { action: "remove this form" }),
  });

  usePageCommands("form-designer", [
    { id: "form.design", label: "Design the form's fields", keywords: "fields questions", run: () => setParams({}) },
    { id: "form.settings", label: "Form settings", keywords: "slug captcha thank you", run: () => setParams({ tab: "settings" }) },
    ...(creating ? [] : [{ id: "form.submissions", label: "See this form's submissions", keywords: "entries responses", run: () => setParams({ tab: "submissions" }) }]),
  ]);

  if ((creating ? list.isLoading : loaded.isLoading) || !draft) {
    if (loaded.isError) return <Alert type="error" showIcon message={errorText(loaded.error)} />;
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }
  const canManage = draft.can_manage;
  const target = draft.targets.find((item) => item.key === draft.target);

  return (
    <div className="nx-td" data-testid="form-designer">
      <PageHeader
        title={<>{draft.name} <em className="nx-em">form</em></>}
        onBack={() => back("/admin/forms")}
        tag={<span className={FORM_STATUS_TONE[draft.status]} style={{ marginInlineStart: 10 }}>{draft.status.toLowerCase()}</span>}
        subtitle={creating ? "Not saved yet" : `${draft.submission_count} submissions · ${draft.public_path} · updated ${relativeTime(draft.updated_at)}`}
        actions={canManage ? (
          <Space wrap>
            {!creating && draft.status === "PUBLISHED" && publicFormsOn && (
              <Tooltip title="Copy the public address">
                <Button icon={<TdIcon name="copy" />} onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}${draft.public_path}`).then(() => message.success("Address copied"))}>
                  Copy link
                </Button>
              </Tooltip>
            )}
            {!creating && (
              <Popconfirm title="Remove this form? Its submissions are kept with their records." onConfirm={() => remove.mutate()}>
                <Button danger>Remove</Button>
              </Popconfirm>
            )}
            <Button loading={save.isPending} disabled={!dirty && !creating} onClick={() => save.mutate(undefined)} data-testid="form-save">Save</Button>
            {draft.status === "PUBLISHED" ? (
              <Button onClick={() => save.mutate("CLOSED")}>Close form</Button>
            ) : (
              <Button type="primary" loading={save.isPending} onClick={() => save.mutate("PUBLISHED")} data-testid="form-publish">Publish</Button>
            )}
          </Space>
        ) : undefined}
      />
      <div className="nx-td-chips" role="tablist" aria-label="Form views">
        {(["design", "settings", "submissions"] as const).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} disabled={creating && key === "submissions"}
            className={`nx-td-chip${tab === key ? " is-on" : ""}`}
            onClick={() => setParams(key === "design" ? {} : { tab: key })}>
            {key === "design" ? "Design" : key === "settings" ? "Settings" : "Submissions"}
            {key === "submissions" && !creating ? <b>{draft.submission_count}</b> : null}
          </button>
        ))}
      </div>
      {tab === "design" && <Designer draft={draft} target={target} editable={canManage} onFields={(fields) => change({ fields })} />}
      {tab === "settings" && <Settings draft={draft} editable={canManage} change={change} changeSettings={changeSettings} />}
      {tab === "submissions" && !creating && <Submissions formId={id} />}
    </div>
  );
}

// ── Design ────────────────────────────────────────────────────────────

function Designer({
  draft, target, editable, onFields,
}: {
  draft: FormDetail; target?: FormTarget; editable: boolean; onFields: (fields: FormField[]) => void;
}) {
  const [selected, setSelected] = useState<string | null>(draft.fields[0]?.id ?? null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [canvasOver, setCanvasOver] = useState(false);
  const fields = draft.fields;
  const field = fields.find((item) => item.id === selected) ?? null;
  const index = field ? fields.indexOf(field) : -1;

  const add = (type: FieldType, at = fields.length) => {
    const created = newField(type, fields);
    const next = [...fields];
    next.splice(at, 0, created);
    onFields(next);
    setSelected(created.id);
  };
  const update = (patch: Partial<FormField>) => onFields(fields.map((item) => (item.id === selected ? { ...item, ...patch } : item)));
  const drop = (at: number, event: React.DragEvent) => {
    event.preventDefault();
    const tool = event.dataTransfer.getData("text/x-td-tool") as FieldType;
    if (tool) add(tool, at);
    else if (dragging !== null) onFields(moved(fields, dragging, at > dragging ? at - 1 : at));
    setDragging(null); setOver(null); setCanvasOver(false);
  };

  const mappable = (target?.fields ?? []).filter((item) => item.kind !== "uuid" || !item.references);
  const used = new Set(fields.map((item) => item.map_to).filter(Boolean));
  const missing = (target?.fields ?? []).filter((item) => item.required && !used.has(item.name) && !(item.name in (draft.settings.defaults ?? {})));

  return (
    <>
      {missing.length > 0 && (
        <Alert type="warning" showIcon message={`Map a field to ${missing.map((item) => item.label.toLowerCase()).join(", ")} — a ${target?.label.replace(/s$/, "").toLowerCase()} cannot be created without it.`} />
      )}
      <div className="nx-td-designer">
        <Card size="small" title="Fields">
          <div className="nx-td-palette" aria-label="Field types">
            {FIELD_TYPES.map((tool) => (
              <button
                key={tool.type}
                type="button"
                className="nx-td-tool"
                draggable={editable}
                disabled={!editable}
                onDragStart={(event) => { event.dataTransfer.setData("text/x-td-tool", tool.type); event.dataTransfer.effectAllowed = "copy"; }}
                onClick={() => add(tool.type)}
                data-testid={`form-tool-${tool.type}`}
                title={`${tool.label} — ${tool.hint}. Drag onto the form, or click to add at the end.`}
              >
                <NxIcon name="plus" size={14} /> {tool.label}
              </button>
            ))}
          </div>
        </Card>

        <Card
          size="small"
          title={<Segmented size="small" value={mode} onChange={(value) => setMode(value as "edit" | "preview")} options={[{ value: "edit", label: "Build" }, { value: "preview", label: "Preview" }]} />}
          extra={<Text type="secondary">{fields.filter((item) => item.type !== "heading").length} fields</Text>}
        >
          {mode === "preview" ? (
            <FormRenderer fields={fields} submitLabel={draft.settings.submit_label} disabled />
          ) : (
            <div
              className={`nx-td-canvas${canvasOver ? " is-over" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setCanvasOver(true); }}
              onDragLeave={() => setCanvasOver(false)}
              onDrop={(event) => drop(fields.length, event)}
              data-testid="form-canvas"
            >
              {fields.length === 0 && <div className="nx-td-drop">Drag a field here</div>}
              {fields.map((item, position) => (
                <div
                  key={item.id}
                  className={`nx-td-field${item.type === "heading" ? " nx-td-field--heading" : ""}${item.id === selected ? " is-on" : ""}${dragging === position ? " is-dragging" : ""}${over === position ? " is-target" : ""}`}
                  draggable={editable}
                  onDragStart={(event) => { setDragging(position); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }}
                  onDragEnd={() => { setDragging(null); setOver(null); }}
                  onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setOver(position); }}
                  onDrop={(event) => { event.stopPropagation(); drop(position, event); }}
                  onClick={() => setSelected(item.id)}
                  data-testid="form-field"
                >
                  <span className="nx-td-grip" aria-hidden><TdIcon name="drag" size={16} stroke={3} /></span>
                  {/* The keyboard way to select a field is this button. The row
                      used to be role="button" itself, wrapping its own move and
                      remove buttons — nested controls a screen reader cannot
                      reach (axe nested-interactive). */}
                  <button type="button" className="nx-td-field-main" aria-pressed={item.id === selected} onClick={(event) => { event.stopPropagation(); setSelected(item.id); }}>
                    <b>{item.label}{item.required ? " *" : ""}</b>
                    <small>
                      {TYPE_LABEL[item.type]}
                      {item.map_to ? ` → ${target?.fields.find((f) => f.name === item.map_to)?.label ?? item.map_to}` : item.type !== "heading" ? " · kept with the submission" : ""}
                      {item.visible_when ? ` · only when ${fields.find((f) => f.id === item.visible_when?.field)?.label ?? "…"} is ${asText(item.visible_when.equals) || "answered"}` : ""}
                    </small>
                  </button>
                  {editable && (
                    <Space size={2}>
                      <Button type="text" aria-label={`Move ${item.label || "this field"} up`} disabled={position === 0} onClick={(e) => { e.stopPropagation(); onFields(moved(fields, position, position - 1)); }} icon={<TdIcon name="up" />} />
                      <Button type="text" aria-label={`Remove ${item.label || "this field"}`} onClick={(e) => { e.stopPropagation(); onFields(fields.filter((f) => f.id !== item.id)); if (selected === item.id) setSelected(null); }} icon={<TdIcon name="x" />} />
                    </Space>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card size="small" title={field ? `${TYPE_LABEL[field.type]} field` : "Field settings"}>
          {!field ? <EmptyState compact title="Select a field to change it" /> : (
            <Space direction="vertical" style={{ width: "100%" }} size={12} data-testid="form-inspector">
              <label>Label<Input value={field.label} disabled={!editable} onChange={(e) => update({ label: e.target.value })} aria-label="Field label" /></label>
              {field.type !== "heading" && (
                <>
                  <label>Help text<Input value={field.help ?? ""} disabled={!editable} onChange={(e) => update({ help: e.target.value })} /></label>
                  {["text", "textarea", "email", "number"].includes(field.type) && (
                    <label>Placeholder<Input value={field.placeholder ?? ""} disabled={!editable} onChange={(e) => update({ placeholder: e.target.value })} /></label>
                  )}
                  <Space><Switch checked={Boolean(field.required)} disabled={!editable} onChange={(required) => update({ required })} aria-label="Required" /> Required</Space>
                  {(field.type === "select" || field.type === "multiselect") && (
                    <label>Options, one per line
                      <Input.TextArea rows={4} disabled={!editable} value={(field.options ?? []).join("\n")} onChange={(e) => update({ options: e.target.value.split("\n") })} aria-label="Options" />
                    </label>
                  )}
                  {field.type === "rating" && (
                    <label>Stars<InputNumber min={3} max={10} value={field.max ?? 5} disabled={!editable} onChange={(max) => update({ max: Number(max) || 5 })} style={{ width: "100%" }} /></label>
                  )}
                  {field.type !== "file" && (
                    <label>Writes to
                      <Select
                        allowClear
                        disabled={!editable}
                        value={field.map_to}
                        placeholder="Kept with the submission only"
                        onChange={(value) => update({ map_to: value })}
                        options={mappable.map((item) => ({
                          value: item.name,
                          label: `${item.label}${item.required ? " (required)" : ""}`,
                          disabled: used.has(item.name) && item.name !== field.map_to,
                        }))}
                        style={{ width: "100%" }}
                        aria-label="Writes to"
                        data-testid="form-map-to"
                      />
                    </label>
                  )}
                </>
              )}
              <label>Show only when
                <Space.Compact style={{ width: "100%" }}>
                  <Select
                    allowClear
                    disabled={!editable || index <= 0}
                    placeholder="Always shown"
                    value={field.visible_when?.field}
                    onChange={(value) => update({ visible_when: value ? { field: value, equals: field.visible_when?.equals ?? "" } : undefined })}
                    options={fields.slice(0, Math.max(0, index)).filter((f) => f.type !== "heading").map((f) => ({ value: f.id, label: f.label }))}
                    style={{ width: "55%" }}
                    aria-label="Depends on"
                  />
                  <Input
                    disabled={!editable || !field.visible_when}
                    placeholder="equals…"
                    value={asText(field.visible_when?.equals)}
                    onChange={(e) => field.visible_when && update({ visible_when: { ...field.visible_when, equals: e.target.value } })}
                    aria-label="Equals"
                  />
                </Space.Compact>
              </label>
              <Text type="secondary" className="nx-td-mono">id: {field.id}</Text>
            </Space>
          )}
        </Card>
      </div>
    </>
  );
}

// ── Settings ──────────────────────────────────────────────────────────

function Settings({
  draft, editable, change, changeSettings,
}: {
  draft: FormDetail; editable: boolean; change: (patch: Partial<FormDetail>) => void; changeSettings: (patch: Partial<FormSettings>) => void;
}) {
  const target = draft.targets.find((item) => item.key === draft.target);
  const defaults = draft.settings.defaults ?? {};
  const [defaultField, setDefaultField] = useState<string | undefined>();
  const choices = useMemo(() => (target?.fields ?? []).filter((item) => item.choices.length > 0), [target]);
  return (
    <div className="nx-td-designer" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
      <Card size="small" title="The form">
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <label>Name<Input value={draft.name} disabled={!editable} onChange={(e) => change({ name: e.target.value })} aria-label="Form name" /></label>
          <label>Description<Input.TextArea rows={3} value={draft.description} disabled={!editable} onChange={(e) => change({ description: e.target.value })} /></label>
          <label>Creates
            <Select value={draft.target} disabled={!editable || draft.submission_count > 0} onChange={(value) => change({ target: value, fields: draft.fields.map((f) => ({ ...f, map_to: undefined })) })}
              options={draft.targets.map((item) => ({ value: item.key, label: item.label }))} style={{ width: "100%" }} aria-label="Creates" />
          </label>
          <label>Public address
            <Input addonBefore={`${window.location.origin}/f/`} value={draft.slug} disabled={!editable} placeholder="support"
              onChange={(e) => change({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} aria-label="Address" />
          </label>
          <label>Who can answer
            <Segmented block value={draft.settings.visibility} disabled={!editable} onChange={(value) => changeSettings({ visibility: value as "PUBLIC" | "INTERNAL" })}
              options={[{ value: "PUBLIC", label: "Anyone with the link" }, { value: "INTERNAL", label: "Signed-in colleagues" }]} />
          </label>
        </Space>
      </Card>
      <Card size="small" title="Answers">
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <label>Button text<Input value={draft.settings.submit_label} disabled={!editable} onChange={(e) => changeSettings({ submit_label: e.target.value })} /></label>
          <label>Confirmation message<Input.TextArea rows={2} value={draft.settings.confirmation} disabled={!editable} onChange={(e) => changeSettings({ confirmation: e.target.value })} /></label>
          <Space><Switch checked={draft.settings.captcha} disabled={!editable} onChange={(captcha) => changeSettings({ captcha })} aria-label="Challenge" /> Ask a question only a person answers (public answers)</Space>
          <label>At most this many answers per address per hour
            <InputNumber min={1} max={1000} value={draft.settings.rate_limit_per_hour} disabled={!editable} onChange={(value) => changeSettings({ rate_limit_per_hour: Number(value) || 10 })} style={{ width: "100%" }} />
          </label>
          <label>Tell these people about each answer
            <PeoplePicker value={draft.settings.notify_user_ids} onChange={(ids) => changeSettings({ notify_user_ids: ids })} />
          </label>
          <div>
            <Text>Every record it creates gets</Text>
            {Object.entries(defaults).map(([name, value]) => (
              <div key={name} className="nx-td-logged-row" style={{ marginTop: 6 }}>
                <span>{target?.fields.find((f) => f.name === name)?.label ?? name}: <b>{String(value)}</b></span>
                {editable && <Button type="text" icon={<TdIcon name="x" />} aria-label={`Remove ${name}`}
                  onClick={() => { const next = { ...defaults }; delete next[name]; changeSettings({ defaults: next }); }} />}
              </div>
            ))}
            {editable && (
              <Space.Compact style={{ width: "100%", marginTop: 8 }}>
                <Select placeholder="Field" value={defaultField} onChange={setDefaultField} style={{ width: "50%" }}
                  options={choices.filter((f) => !(f.name in defaults)).map((f) => ({ value: f.name, label: f.label }))} aria-label="Default field" />
                <Select placeholder="Value" disabled={!defaultField} style={{ width: "50%" }} value={undefined}
                  options={(choices.find((f) => f.name === defaultField)?.choices ?? []).map((c) => ({ value: c, label: c }))}
                  onChange={(value: string) => { if (defaultField) { changeSettings({ defaults: { ...defaults, [defaultField]: value } }); setDefaultField(undefined); } }} aria-label="Default value" />
              </Space.Compact>
            )}
          </div>
        </Space>
      </Card>
    </div>
  );
}

// ── Submissions ───────────────────────────────────────────────────────

function Submissions({ formId }: { formId: string }) {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: queryKeys.forms("submissions", formId, status, page),
    queryFn: ({ signal }) => formsApi.submissions(formId, { status, page }, signal),
  });
  const retry = useMutation({
    mutationFn: (submissionId: string) => formsApi.retry(formId, submissionId),
    onSuccess: (item) => { void client.invalidateQueries({ queryKey: queryKeys.forms() }); message.success(item.status === "CONVERTED" ? "It became a record" : "Still failing — see why"); },
    onError: errorToast(message, { action: "retry this submission" }),
  });
  if (list.isLoading) return <Skeleton active />;
  if (list.isError || !list.data) return <Alert type="error" showIcon message={errorText(list.error)} />;
  const data = list.data;
  const tone = { CONVERTED: "nx-td-pilltag nx-td-pilltag--ok", FAILED: "nx-td-pilltag nx-td-pilltag--bad", SPAM: "nx-td-pilltag" } as const;
  return (
    <>
      <div className="nx-td-chips">
        {["", "CONVERTED", "FAILED", "SPAM"].map((key) => (
          <button key={key || "all"} type="button" className={`nx-td-chip${status === key ? " is-on" : ""}`} onClick={() => { setStatus(key); setPage(1); }}>
            {key ? key.toLowerCase() : "All"} <b>{key ? data.counts[key] ?? 0 : Object.values(data.counts).reduce((a, b) => a + b, 0)}</b>
          </button>
        ))}
      </div>
      {data.items.length === 0 ? <div className="nx-td-empty">No submissions.</div> : (
        <div className="nx-td-list" data-testid="form-submissions">
          {data.items.map((item) => (
            <div key={item.id} className="nx-td-row nx-td-row--nocheck">
              <span className="nx-td-row-icon"><NxIcon name="inbox" /></span>
              <div className="nx-td-row-main">
                <button type="button" className="nx-td-row-title" onClick={() => setOpen(open === item.id ? null : item.id)}>
                  {item.reference} · {asText(item.answers.find((a) => a.label)?.value) || (item.submitter_email ?? "")}
                </button>
                <div className="nx-td-row-meta">
                  <span title={absoluteTime(item.created_at)}>{relativeTime(item.created_at)}</span>
                  {item.submitter_email && <span>{item.submitter_email}</span>}
                  {item.error && <span style={{ color: "var(--nu-bad)" }}>{item.error}</span>}
                </div>
                {open === item.id && (
                  <dl className="nx-td-facts" style={{ marginTop: 8 }}>
                    {item.answers.map((answer) => (
                      <Fragment key={answer.id}><dt>{answer.label}</dt><dd>{Array.isArray(answer.value) ? answer.value.join(", ") : String(answer.value)}</dd></Fragment>
                    ))}
                  </dl>
                )}
              </div>
              <div className="nx-td-row-side">
                <span className={tone[item.status]}>{item.status.toLowerCase()}</span>
                {item.record_path && <Link to={item.record_path}><Button icon={<TdIcon name="link" />}>{item.record_label || "Record"}</Button></Link>}
                {item.status === "FAILED" && <Button loading={retry.isPending} onClick={() => retry.mutate(item.id)}>Try again</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {data.total > data.page_size && <Pagination current={page} pageSize={data.page_size} total={data.total} onChange={setPage} showSizeChanger={false} align="end" />}
    </>
  );
}
