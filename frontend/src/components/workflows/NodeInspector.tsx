/**
 * The selected step, edited (§49).
 *
 * One panel for every kind of node, because what changes between them is the
 * fields, not the frame. Conditions reuse the advanced search's own builder —
 * the same fields, operators and compiled SQL — so a branch on the canvas and a
 * saved search can never disagree about what "priority is high" means.
 *
 * It also carries **Next step**, one picker per output: everything the canvas
 * does by dragging a wire is possible here without a pointer.
 */

import { Alert, Button, Input, InputNumber, Select, Switch, Typography } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

import type { AutomationCatalogue } from "@/api/automations";
import type { ExplorerResource } from "@/api/explorer";
import type { CanvasCatalogueExtras, GraphNode, WorkflowGraph } from "@/api/workflowGraph";
import { AdvancedQueryBuilder } from "@/components/explorer/AdvancedQueryBuilder";
import { emptyTree, type QueryNode } from "@/components/explorer/queryTree";
import { PeoplePicker } from "@/components/PeoplePicker";

import { PORT_LABEL, connect, connectionProblem, disconnect, portsOf, removeNode, str, updateData } from "./graph";

const { Text } = Typography;

type Catalogue = AutomationCatalogue & CanvasCatalogueExtras;

const SCHEDULES = [
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 8 * * 1-5", label: "Weekdays at 08:00" },
  { value: "0 9 * * 1", label: "Mondays at 09:00" },
  { value: "0 0 1 * *", label: "First of the month" },
];

export function NodeInspector({
  node,
  graph,
  onChange,
  catalogue,
  datasets,
  problems,
  summaries,
  readOnly,
  onClose,
}: {
  node: GraphNode;
  graph: WorkflowGraph;
  onChange: (graph: WorkflowGraph) => void;
  catalogue: Catalogue;
  datasets: ExplorerResource[];
  problems: string[];
  summaries: Record<string, { title: string }>;
  readOnly?: boolean;
  onClose?: () => void;
}) {
  const data = node.data;
  const set = (changes: Record<string, unknown>) => onChange(updateData(graph, node.id, { ...data, ...changes }));
  const trigger = graph.nodes.find((item) => item.type === "trigger");
  const datasetKey = (str(trigger?.data.resource_type) || "task");
  const dataset = datasets.find((item) => item.key === datasetKey);
  const kind = str(data.kind);

  return (
    <div className="nx-wf-inspector" data-testid="node-inspector">
      <div className="nx-wf-inspector-head">
        <div>
          <div className="nx-wf-inspector-kind">{node.type === "trigger" ? "Trigger" : node.type === "action" ? "Action" : node.type === "branch" ? "Branch" : "Condition"}</div>
          <div className="nx-wf-inspector-title">{summaries[node.id]?.title ?? node.id}</div>
        </div>
        {onClose && <Button type="text" size="small" onClick={onClose} aria-label="Close step">Done</Button>}
      </div>

      {problems.length > 0 && (
        <Alert type="error" showIcon className="nx-wf-inspector-alert" data-testid="inspector-problems"
          message={problems.length === 1 ? problems[0] : `${problems.length} things to fix`}
          description={problems.length > 1 ? <ul>{problems.map((item) => <li key={item}>{item}</li>)}</ul> : undefined} />
      )}

      <fieldset disabled={readOnly} className="nx-wf-fields">
        {node.type === "trigger" && (
          <>
            <Field label="Starts when">
              <Select aria-label="Trigger" value={str(data.event) || undefined}
                onChange={(event: string) => set({ event })}
                options={catalogue.triggers.map((item) => ({ value: item.event, label: item.label }))} />
              <Text type="secondary" className="nx-wf-hint">
                {catalogue.triggers.find((item) => item.event === data.event)?.description}
              </Text>
            </Field>
            <Field label="Dataset">
              <Select aria-label="Dataset" value={datasetKey} showSearch optionFilterProp="label"
                onChange={(resource_type: string) => set({ resource_type, field: undefined, to: undefined })}
                options={catalogue.resources.map((item) => ({ value: item.key, label: item.label }))} />
            </Field>
            {data.event === "FIELD_CHANGED" && (
              <>
                <Field label="Field">
                  <Select aria-label="Changed field" value={str(data.field) || undefined} showSearch
                    optionFilterProp="label" placeholder="Choose a field"
                    onChange={(field: string) => set({ field, to: undefined })}
                    options={(dataset?.fields ?? []).map((field) => ({ value: field.name, label: field.label }))} />
                </Field>
                <Field label="Only when it becomes (optional)">
                  {(() => {
                    const field = dataset?.fields.find((item) => item.name === data.field);
                    return field?.choices.length ? (
                      <Select aria-label="Changes to" allowClear value={str(data.to) || undefined}
                        onChange={(to?: string) => set({ to: to ?? "" })}
                        options={field.choices.map((choice) => ({ value: choice, label: choice }))} />
                    ) : (
                      <Input aria-label="Changes to" value={str(data.to)} placeholder="Any value"
                        onChange={(event) => set({ to: event.target.value })} />
                    );
                  })()}
                </Field>
              </>
            )}
            {data.event === "SCHEDULE" && (
              <Field label="Schedule (cron)">
                <Select aria-label="Schedule presets" placeholder="A common schedule" value={undefined}
                  onChange={(schedule: string) => set({ schedule })} options={SCHEDULES} />
                <Input aria-label="Cron expression" value={str(data.schedule)} placeholder="0 8 * * 1-5"
                  onChange={(event) => set({ schedule: event.target.value })} />
                <Text type="secondary" className="nx-wf-hint">
                  Minute, hour, day, month, weekday. Each run looks at the records the first condition selects.
                </Text>
              </Field>
            )}
            {data.event === "FORM_SUBMITTED" && (
              <Field label="Form">
                <Select aria-label="Form" allowClear placeholder="Any form" value={str(data.form) || undefined}
                  onChange={(form?: string) => set({ form: form ?? "" })}
                  options={catalogue.forms.filter((form) => form.target === datasetKey)
                    .map((form) => ({ value: form.slug, label: form.name }))} />
              </Field>
            )}
            {data.event === "WEBHOOK" && (
              <Text type="secondary" className="nx-wf-hint">
                Publishing gives this workflow its own address. POST <code>{"{\"record_id\": \"…\"}"}</code> to it.
              </Text>
            )}
          </>
        )}

        {(node.type === "condition" || node.type === "branch") && (
          <Field label="Rules">
            <Text type="secondary" className="nx-wf-hint">
              {node.type === "branch" ? "Records that match go down Yes; the rest go down No." : "Only records that match carry on."}
            </Text>
            {dataset ? (
              <AdvancedQueryBuilder
                fields={dataset.fields}
                value={(data.tree as QueryNode | undefined) ?? emptyTree()}
                onChange={(tree) => set({ tree })}
              />
            ) : (
              <Text type="secondary">Choose the trigger's dataset first.</Text>
            )}
          </Field>
        )}

        {node.type === "action" && (
          <ActionFields kind={kind} data={data} set={set} catalogue={catalogue} dataset={dataset} datasets={datasets} />
        )}
      </fieldset>

      <div className="nx-wf-next">
        <Text strong className="nx-wf-label">Next step</Text>
        {portsOf(node).map((port) => {
          const current = graph.edges.find((edge) => edge.source === node.id && edge.port === port);
          return (
            <div key={port} className="nx-wf-next-row">
              {PORT_LABEL[port] && <span className={`nx-wf-port-chip nx-wf-port-chip--${port}`}>{PORT_LABEL[port]}</span>}
              <Select
                aria-label={`Next step${PORT_LABEL[port] ? ` when ${PORT_LABEL[port]}` : ""}`}
                data-testid={`next-${port}`}
                allowClear
                disabled={readOnly}
                placeholder="Nothing — the workflow ends here"
                value={current?.target}
                onChange={(target?: string) => {
                  if (!target) {
                    if (current) onChange(disconnect(graph, current.id));
                    return;
                  }
                  if (!connectionProblem(graph, node.id, port, target)) onChange(connect(graph, node.id, port, target));
                }}
                options={graph.nodes
                  .filter((item) => item.id !== node.id && item.type !== "trigger")
                  .map((item) => ({
                    value: item.id,
                    label: summaries[item.id]?.title ?? item.id,
                    disabled: item.id !== current?.target && Boolean(connectionProblem(graph, node.id, port, item.id)),
                  }))}
              />
            </div>
          );
        })}
      </div>

      {node.type !== "trigger" && !readOnly && (
        <Button danger icon={<DeleteOutlined />} className="nx-wf-remove" data-testid="remove-node"
          onClick={() => { onChange(removeNode(graph, node.id)); onClose?.(); }}>
          Remove this step
        </Button>
      )}
    </div>
  );
}

function ActionFields({ kind, data, set, catalogue, dataset, datasets }: {
  kind: string;
  data: Record<string, unknown>;
  set: (changes: Record<string, unknown>) => void;
  catalogue: Catalogue;
  dataset?: ExplorerResource;
  datasets: ExplorerResource[];
}) {
  const recipients = (data.recipients as { user_ids?: string[]; role?: string; owner?: boolean } | undefined) ?? {};
  const setRecipients = (changes: Record<string, unknown>) =>
    set({ recipients: { user_ids: recipients.user_ids ?? [], role: recipients.role ?? "", owner: recipients.owner ?? false, ...changes } });
  const text = (name: string, label: string, placeholder = "{rule}: {record}") => (
    <Field label={label}>
      <Input aria-label={label} value={str(data[name])} placeholder={placeholder}
        onChange={(event) => set({ [name]: event.target.value })} />
    </Field>
  );

  return (
    <>
      <Text type="secondary" className="nx-wf-hint">
        {[...catalogue.canvas_actions, ...catalogue.flow].find((item) => item.kind === kind)?.description}
      </Text>
      {(kind === "NOTIFY" || kind === "EMAIL") && (
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
          {kind === "EMAIL" ? text("subject", "Subject") : text("title", "Title")}
          {text("body", "Message", "Optional")}
        </>
      )}
      {kind === "TASK" && (
        <>
          {text("title", "Task title", "Follow up {record}")}
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
      )}
      {kind === "WEBHOOK" && text("url", "POST to", "https://example.internal/hooks/nucleus")}
      {kind === "UPDATE_FIELD" && (
        <>
          <Field label="Field">
            <Select aria-label="Field to set" showSearch optionFilterProp="label" placeholder="Choose a field"
              value={str(data.field) || undefined} onChange={(field: string) => set({ field, value: undefined })}
              options={(dataset?.fields ?? []).filter((field) => field.editable).map((field) => ({ value: field.name, label: field.label }))} />
          </Field>
          <Field label="Set it to">
            {(() => {
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
            })()}
          </Field>
        </>
      )}
      {kind === "ASSIGN" && (
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
      )}
      {kind === "CREATE_RECORD" && (
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
      )}
      {kind === "WAIT" && (
        <Field label="Wait for (minutes)">
          <InputNumber aria-label="Minutes" min={1} max={catalogue.limits_graph.max_wait_minutes} className="nu-block"
            value={Number(data.minutes ?? 60)} onChange={(minutes) => set({ minutes })} />
        </Field>
      )}
      {kind === "APPROVAL" && (
        <>
          {text("title", "What is asked", "Approve {record}")}
          {text("body", "Why", "Optional")}
          <Field label="Ask (optional)">
            <PeoplePicker aria-label="Approver" multiple={false} value={data.assignee_id ? [str(data.assignee_id)] : []}
              onChange={(ids) => set({ assignee_id: ids[0] ?? undefined })} />
          </Field>
          <Text type="secondary" className="nx-wf-hint">Anybody who may decide approvals can answer it in the approvals inbox.</Text>
        </>
      )}
      {!["WEBHOOK", "WAIT", "UPDATE_FIELD", "ASSIGN"].includes(kind) && (
        <Text type="secondary" className="nx-wf-hint">Wording may use {"{record}"}, {"{rule}"}, {"{link}"} and {"{severity}"}.</Text>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="nx-wf-field">
      <span className="nx-wf-label">{label}</span>
      {children}
    </div>
  );
}
