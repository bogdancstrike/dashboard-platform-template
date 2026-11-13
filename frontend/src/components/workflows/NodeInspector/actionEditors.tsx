/**
 * The settings of each action kind — a registry from kind to editor, the
 * inspector's half of the node-type registry in `graph/nodeTypes.ts`.
 */
import type { ComponentType } from "react";
import { Input, InputNumber, Select, Switch, Typography } from "antd";

import { PeoplePicker } from "@/components/PeoplePicker";

import { str } from "../graph";
import { Field, TextField } from "./Field";
import type { EditorProps } from "./types";

const { Text } = Typography;

type Recipients = { user_ids?: string[]; role?: string; owner?: boolean };

/** Who is told, and what it says — for a notification and an email alike. */
function MessageEditor({ data, set, catalogue, kind }: EditorProps & { kind: string }) {
  const recipients = (data.recipients as Recipients | undefined) ?? {};
  const setRecipients = (changes: Record<string, unknown>) =>
    set({ recipients: { user_ids: recipients.user_ids ?? [], role: recipients.role ?? "", owner: recipients.owner ?? false, ...changes } });
  return (
    <>
      <Field label="The workflow's owner">
        <Switch aria-label="Owner" checked={Boolean(recipients.owner)} onChange={(owner) => setRecipients({ owner })} />
      </Field>
      <Field label="Anybody holding">
        <Select aria-label="Role" allowClear placeholder="No role" value={recipients.role || undefined}
          onChange={(role?: string) => setRecipients({ role: role ?? "" })}
          options={catalogue.roles.map((role) => ({ value: role.code, label: role.name }))} />
      </Field>
      <Field label="And these people">
        <PeoplePicker aria-label="People" value={recipients.user_ids ?? []} onChange={(user_ids) => setRecipients({ user_ids })} />
      </Field>
      {kind === "EMAIL" ? <TextField name="subject" label="Subject" data={data} set={set} /> : <TextField name="title" label="Title" data={data} set={set} />}
      <TextField name="body" label="Message" placeholder="Optional" data={data} set={set} />
    </>
  );
}

function TaskEditor({ data, set, catalogue }: EditorProps) {
  return (
    <>
      <TextField name="title" label="Task title" placeholder="Follow up {record}" data={data} set={set} />
      <Field label="Priority">
        <Select aria-label="Priority" value={(str(data.priority) || "HIGH")} onChange={(priority: string) => set({ priority })}
          options={catalogue.priorities.map((item) => ({ value: item, label: item.charAt(0) + item.slice(1).toLowerCase() }))} />
      </Field>
      <Field label="Assign to">
        <PeoplePicker aria-label="Assignee" multiple={false}
          value={data.assignee_id ? [str(data.assignee_id)] : []}
          onChange={(ids) => set({ assignee_id: ids[0] ?? undefined })} />
      </Field>
    </>
  );
}

function WebhookEditor({ data, set }: EditorProps) {
  return <TextField name="url" label="POST to" placeholder="https://example.internal/hooks/nucleus" data={data} set={set} />;
}

function UpdateFieldEditor({ data, set, dataset }: EditorProps) {
  return (
    <>
      <Field label="Field">
        <Select aria-label="Field to set" showSearch optionFilterProp="label" placeholder="Choose a field"
          value={str(data.field) || undefined} onChange={(field: string) => set({ field, value: undefined })}
          options={(dataset?.fields ?? []).filter((field) => field.editable).map((field) => ({ value: field.name, label: field.label }))} />
      </Field>
      <Field label="Set it to">
        <NewValue data={data} set={set} dataset={dataset} />
      </Field>
    </>
  );
}

/** The value to set, in the control the field's kind asks for. */
function NewValue({ data, set, dataset }: Pick<EditorProps, "data" | "set" | "dataset">) {
  const field = dataset?.fields.find((item) => item.name === data.field);
  if (field?.choices.length) {
    return <Select aria-label="New value" value={str(data.value) || undefined}
      onChange={(value: string) => set({ value })} options={field.choices.map((choice) => ({ value: choice, label: choice }))} />;
  }
  if (field?.kind === "number") {
    return <InputNumber aria-label="New value" value={data.value as number | undefined}
      onChange={(value) => set({ value })} className="nu-block" />;
  }
  return <Input aria-label="New value" value={str(data.value)} placeholder="May use {record}"
    onChange={(event) => set({ value: event.target.value })} />;
}

function AssignEditor({ data, set }: EditorProps) {
  return (
    <>
      <Field label="To the workflow's owner">
        <Switch aria-label="To the owner" checked={Boolean(data.to_owner)} onChange={(to_owner) => set({ to_owner, assignee_id: to_owner ? undefined : data.assignee_id })} />
      </Field>
      {!data.to_owner && (
        <Field label="To this person">
          <PeoplePicker aria-label="Assign to" multiple={false} value={data.assignee_id ? [str(data.assignee_id)] : []}
            onChange={(ids) => set({ assignee_id: ids[0] ?? undefined })} />
        </Field>
      )}
    </>
  );
}

function CreateRecordEditor({ data, set, datasets }: EditorProps) {
  return (
    <>
      <Field label="In">
        <Select aria-label="Create in" value={(str(data.resource_type) || "task")}
          onChange={(resource_type: string) => set({ resource_type, values: {} })}
          options={datasets.filter((item) => item.fields.some((field) => field.editable))
            .map((item) => ({ value: item.key, label: item.label }))} />
      </Field>
      {(datasets.find((item) => item.key === data.resource_type)?.fields ?? [])
        .filter((field) => field.required)
        .map((field) => (
          <Field key={field.name} label={field.label}>
            <Input aria-label={field.label}
              value={str(((data.values as Record<string, unknown> | undefined) ?? {})[field.name])}
              placeholder="May use {record}"
              onChange={(event) => set({ values: { ...((data.values) ?? {}), [field.name]: event.target.value } })} />
          </Field>
        ))}
    </>
  );
}

function WaitEditor({ data, set, catalogue }: EditorProps) {
  return (
    <Field label="Wait for (minutes)">
      <InputNumber aria-label="Minutes" min={1} max={catalogue.limits_graph.max_wait_minutes} className="nu-block"
        value={Number(data.minutes ?? 60)} onChange={(minutes) => set({ minutes })} />
    </Field>
  );
}

function ApprovalEditor({ data, set }: EditorProps) {
  return (
    <>
      <TextField name="title" label="What is asked" placeholder="Approve {record}" data={data} set={set} />
      <TextField name="body" label="Why" placeholder="Optional" data={data} set={set} />
      <Field label="Ask (optional)">
        <PeoplePicker aria-label="Approver" multiple={false} value={data.assignee_id ? [str(data.assignee_id)] : []}
          onChange={(ids) => set({ assignee_id: ids[0] ?? undefined })} />
      </Field>
      <Text type="secondary" className="nx-wf-hint">Anybody who may decide approvals can answer it in the approvals inbox.</Text>
    </>
  );
}

export const ACTION_EDITORS: Record<string, ComponentType<EditorProps & { kind: string }>> = {
  NOTIFY: MessageEditor,
  EMAIL: MessageEditor,
  TASK: TaskEditor,
  WEBHOOK: WebhookEditor,
  UPDATE_FIELD: UpdateFieldEditor,
  ASSIGN: AssignEditor,
  CREATE_RECORD: CreateRecordEditor,
  WAIT: WaitEditor,
  APPROVAL: ApprovalEditor,
};

/** Kinds whose wording cannot use the record placeholders, so the hint is left off. */
const NO_WORDING = ["WEBHOOK", "WAIT", "UPDATE_FIELD", "ASSIGN"];

/** One action's description, its kind's editor, and the placeholder hint where wording applies. */
export function ActionFields({ kind, ...props }: EditorProps & { kind: string }) {
  const Editor = ACTION_EDITORS[kind];
  return (
    <>
      <Text type="secondary" className="nx-wf-hint">
        {[...props.catalogue.canvas_actions, ...props.catalogue.flow].find((item) => item.kind === kind)?.description}
      </Text>
      {Editor && <Editor kind={kind} {...props} />}
      {!NO_WORDING.includes(kind) && (
        <Text type="secondary" className="nx-wf-hint">Wording may use {"{record}"}, {"{rule}"}, {"{link}"} and {"{severity}"}.</Text>
      )}
    </>
  );
}
