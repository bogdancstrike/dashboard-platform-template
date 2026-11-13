import "@/styles/decisions.css";

import {
  Alert, App, Button, Checkbox, Drawer, Form, Input, InputNumber, Modal, Pagination, Popconfirm, Segmented,
  Select, Skeleton, Space, Switch, Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  age, approvalsApi, type Approval, type ApprovalDetail, type ApprovalScope, type ChangeRule, type RuleCatalogue,
} from "@/api/approvals";
import { hours } from "@/api/time";
import { URL_OVERLAY } from "@/app/history";
import { useUrlOverlay } from "@/app/useUrlOverlay";
import { useAuth } from "@/auth/AuthProvider";
import { usePageCommands } from "@/commands/CommandContext";
import { TdIcon, type TdIconName } from "@/components/decisions/TdIcon";
import { NxIcon, type NxIconName } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { asText } from "@/lib/text";
import { errorText, errorToast } from "@/lib/errors";
import { absoluteTime, relativeTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";
import { queryKeys } from "@/lib/queryKeys";

const { Text, Paragraph } = Typography;

const STATUS_TONE: Record<string, string> = {
  PENDING: "nx-td-pilltag nx-td-pilltag--acc",
  APPROVED: "nx-td-pilltag nx-td-pilltag--ok",
  REJECTED: "nx-td-pilltag nx-td-pilltag--bad",
  WITHDRAWN: "nx-td-pilltag",
};

export function KindIcon({ icon, size = 18 }: { icon: string; size?: number }) {
  const td: Record<string, TdIconName> = { key: "key", clock: "clock", pen: "form", check: "stamp" };
  if (icon in td) return <TdIcon name={td[icon]!} size={size} />;
  return <NxIcon name={(icon as NxIconName) || "check"} size={size} />;
}

function Standing({ item }: { item: Approval }) {
  if (item.status !== "PENDING") {
    return <span className={STATUS_TONE[item.status]}>{item.status.toLowerCase()}</span>;
  }
  if (item.standing === "overdue") {
    return <span className="nx-td-pilltag nx-td-pilltag--bad">Overdue {age(Math.abs(item.due_in_hours ?? 0))}</span>;
  }
  if (item.standing === "due_soon") {
    return <span className="nx-td-pilltag nx-td-pilltag--warn">Due in {age(item.due_in_hours ?? 0)}</span>;
  }
  return <span className="nx-td-pilltag nx-td-pilltag--ok">Due in {age(item.due_in_hours ?? 0)}</span>;
}

const SCOPES: { key: ApprovalScope | "rules"; label: string }[] = [
  { key: "inbox", label: "Needs a decision" },
  { key: "mine", label: "My requests" },
  { key: "history", label: "Decided" },
  { key: "rules", label: "Rules" },
];

/**
 * One queue for every "needs a decision" item: timesheets, access requests,
 * edits a rule held back, reports somebody wants to publish. The scope is a
 * place (pushed), the filters are filters (replaced), and the open request is
 * a URL overlay so back closes it.
 */
export default function ApprovalsPage() {
  const [params, setParams] = useSearchParams();
  const scope = (params.get("scope") as ApprovalScope | "rules" | null) ?? "inbox";
  const set = (next: Record<string, string | null>, replace = true) => {
    const copy = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (!value) copy.delete(key);
      else copy.set(key, value);
    }
    setParams(copy, { replace });
  };

  const counts = useQuery({
    queryKey: queryKeys.approvals("list", { scope: "inbox", page_size: 1 }),
    queryFn: ({ signal }) => approvalsApi.list({ scope: "inbox", page_size: 1 }, signal),
  });

  return (
    <div className="nx-td" data-testid="approvals-page">
      <PageHeader
        title={<>Approvals <em>inbox</em></>}
        subtitle={
          counts.data
            ? `${counts.data.counts.inbox} waiting on you · ${counts.data.counts.overdue} overdue · ${counts.data.counts.mine_pending} of yours pending`
            : "Everything that needs a decision, in one place."
        }
      />
      <div className="nx-td-chips" role="tablist" aria-label="Approval views">
        {SCOPES.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={scope === item.key}
            className={`nx-td-chip${scope === item.key ? " is-on" : ""}`}
            onClick={() => set({ scope: item.key === "inbox" ? null : item.key, kind: null, requester: null, age: null, q: null }, false)}
            data-testid={`approvals-scope-${item.key}`}
          >
            {item.label}
            {item.key === "inbox" && counts.data ? <b>{counts.data.counts.inbox}</b> : null}
            {item.key === "mine" && counts.data ? <b>{counts.data.counts.mine_pending}</b> : null}
          </button>
        ))}
      </div>
      {scope === "rules" ? <RulesView /> : <Queue scope={scope} params={params} set={set} />}
      <ApprovalDrawer />
    </div>
  );
}

function Queue({
  scope, params, set,
}: {
  scope: ApprovalScope;
  params: URLSearchParams;
  set: (next: Record<string, string | null>, replace?: boolean) => void;
}) {
  const { message, modal } = App.useApp();
  const client = useQueryClient();
  const overlay = useUrlOverlay("open");
  const [box, setBox] = useState(params.get("q") ?? "");
  const q = useDebouncedValue(box, 300);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const kind = params.get("kind") ?? "";
  const requester = params.get("requester") ?? "";
  const ageFilter = params.get("age") ?? "";

  useEffect(() => {
    if ((params.get("q") ?? "") !== q) set({ q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => { setPage(1); setSelected([]); }, [scope, kind, requester, ageFilter, q]);

  const query = { scope, kind, requester_id: requester, age: ageFilter, q, page, page_size: 20 };
  const list = useQuery({
    queryKey: queryKeys.approvals("list", query),
    queryFn: ({ signal }) => approvalsApi.list(query, signal),
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: queryKeys.approvals() });
    void client.invalidateQueries({ queryKey: queryKeys.notifications("counts") });
    void client.invalidateQueries({ queryKey: queryKeys.time() });
  };

  const bulk = useMutation({
    mutationFn: ({ decision, comment }: { decision: "approve" | "reject"; comment: string }) =>
      approvalsApi.bulk(selected, decision, comment),
    onSuccess: (result) => {
      refresh();
      setSelected([]);
      if (result.failed) {
        message.warning(`${result.decided} decided, ${result.failed} could not be: ${result.results.find((r) => !r.ok)?.error ?? ""}`);
      } else {
        message.success(`${result.decided} decided`);
      }
    },
    onError: errorToast(message, { action: "decide these" }),
  });

  const quick = useMutation({
    mutationFn: ({ id, decision, comment }: { id: string; decision: "approve" | "reject"; comment: string }) =>
      approvalsApi.decide(id, decision, comment),
    onSuccess: (row) => { refresh(); message.success(`${row.reference} ${row.status.toLowerCase()}`); },
    onError: errorToast(message, { action: "decide this" }),
  });

  const ask = (decision: "approve" | "reject", run: (comment: string) => void, count = 1) => {
    let comment = "";
    const reject = decision === "reject";
    const many = count > 1 ? `${count} requests` : "this request";
    // A rejection needs a reason, so its button waits for one.
    const dialog = modal.confirm({
      icon: null,
      title: reject ? `Reject ${many}?` : `Approve ${many}?`,
      content: (
        <Input.TextArea
          rows={3}
          autoFocus
          aria-label="Comment"
          placeholder={reject ? "Why — the requester will read this (required)" : "A comment for the requester (optional)"}
          onChange={(event) => {
            comment = event.target.value;
            if (reject) dialog.update({ okButtonProps: { danger: true, disabled: !comment.trim() } });
          }}
        />
      ),
      okText: reject ? "Reject" : "Approve",
      okButtonProps: { danger: reject, disabled: reject },
      onOk: () => run(comment.trim()),
    });
  };

  usePageCommands("approvals", selected.length ? [
    { id: "approvals.bulk-approve", label: `Approve ${selected.length} selected`, run: () => ask("approve", (comment) => bulk.mutate({ decision: "approve", comment }), selected.length) },
  ] : []);

  const data = list.data;
  const decidable = (data?.items ?? []).filter((item) => item.can_decide);

  return (
    <>
      <div className="nx-td-bar" role="search">
        <Input
          className="nx-td-grow"
          allowClear
          prefix={<NxIcon name="search" size={16} />}
          placeholder="Search by title, reference or record"
          aria-label="Search requests"
          value={box}
          onChange={(event) => setBox(event.target.value)}
        />
        <Select
          aria-label="Kind"
          value={kind}
          style={{ minWidth: 170 }}
          popupMatchSelectWidth={false}
          onChange={(value) => set({ kind: value })}
          options={[
            { value: "", label: "Kind: any" },
            ...(data?.kinds ?? []).map((item) => ({
              value: item.kind,
              label: `${item.label} (${data?.facets.kind[item.kind] ?? 0})`,
            })),
          ]}
        />
        <Select
          aria-label="Requester"
          value={requester}
          showSearch
          optionFilterProp="label"
          style={{ minWidth: 170 }}
          popupMatchSelectWidth={false}
          onChange={(value) => set({ requester: value })}
          options={[
            { value: "", label: "Requester: anyone" },
            ...(data?.facets.requester ?? []).map((item) => ({ value: item.id, label: `${item.name} (${item.count})` })),
          ]}
        />
        <Segmented
          value={ageFilter}
          onChange={(value) => set({ age: String(value) })}
          options={[
            { value: "", label: "Any age" }, { value: "today", label: "Today" }, { value: "week", label: "This week" },
            { value: "older", label: "Older" }, { value: "overdue", label: "Overdue" },
          ]}
        />
      </div>

      {list.isLoading ? <Skeleton active paragraph={{ rows: 6 }} /> : list.isError || !data ? (
        <Alert type="error" showIcon message={errorText(list.error, { fallback: "The inbox could not be read." })} />
      ) : data.items.length === 0 ? (
        <div className="nx-td-empty">
          <EmptyState title={scope === "inbox" ? "Nothing is waiting on you. Inbox zero." : "No requests match."} />
        </div>
      ) : (
        <>
          {scope === "inbox" && decidable.length > 0 && (
            <Checkbox
              checked={selected.length > 0 && selected.length === decidable.length}
              indeterminate={selected.length > 0 && selected.length < decidable.length}
              onChange={(event) => setSelected(event.target.checked ? decidable.map((item) => item.id) : [])}
            >
              Select all on this page
            </Checkbox>
          )}
          <div className="nx-td-list" data-testid="approvals-list">
            {data.items.map((item) => (
              <div
                key={item.id}
                className={`nx-td-row${scope === "inbox" ? "" : " nx-td-row--nocheck"}${selected.includes(item.id) ? " is-selected" : ""}`}
                data-testid="approval-row"
              >
                {scope === "inbox" && (
                  <Checkbox
                    aria-label={`Select ${item.reference}`}
                    disabled={!item.can_decide}
                    checked={selected.includes(item.id)}
                    onChange={(event) =>
                      setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))
                    }
                  />
                )}
                <span className="nx-td-row-icon"><KindIcon icon={item.icon} /></span>
                <div className="nx-td-row-main">
                  <button type="button" className="nx-td-row-title" onClick={() => overlay.open(item.id)}>
                    {item.title}
                  </button>
                  <div className="nx-td-row-meta">
                    <span className="nx-td-mono">{item.reference}</span>
                    <span>{item.kind_label}</span>
                    {item.requester && <span>by {item.requester.name}</span>}
                    <span title={absoluteTime(item.created_at)}>{relativeTime(item.created_at)}</span>
                    {item.decided_by && <span>decided by {item.decided_by.name}</span>}
                  </div>
                </div>
                <div className="nx-td-row-side">
                  <Standing item={item} />
                  {item.can_decide && (
                    <>
                      <Button
                        type="primary"
                        onClick={() => quick.mutate({ id: item.id, decision: "approve", comment: "" })}
                        data-testid="approval-quick-approve"
                      >
                        Approve
                      </Button>
                      <Button onClick={() => ask("reject", (comment) => quick.mutate({ id: item.id, decision: "reject", comment }))}>
                        Reject
                      </Button>
                    </>
                  )}
                  {!item.can_decide && <Button onClick={() => overlay.open(item.id)}>Open</Button>}
                </div>
              </div>
            ))}
          </div>
          {data.total > data.page_size && (
            <Pagination current={page} pageSize={data.page_size} total={data.total} onChange={setPage} showSizeChanger={false} align="end" />
          )}
        </>
      )}

      {selected.length > 0 && (
        <div className="nx-td-bulk" data-testid="approvals-bulk">
          <b className="nx-td-grow">{selected.length} selected</b>
          <Button onClick={() => setSelected([])}>Clear</Button>
          <Button onClick={() => ask("reject", (comment) => bulk.mutate({ decision: "reject", comment }), selected.length)}>
            Reject
          </Button>
          <Button
            type="primary"
            loading={bulk.isPending}
            onClick={() => ask("approve", (comment) => bulk.mutate({ decision: "approve", comment }), selected.length)}
            data-testid="approvals-bulk-approve"
          >
            Approve {selected.length}
          </Button>
        </div>
      )}
    </>
  );
}

function ApprovalDrawer() {
  const overlay = useUrlOverlay("open");
  const { message } = App.useApp();
  const client = useQueryClient();
  const [comment, setComment] = useState("");
  const detail = useQuery({
    queryKey: queryKeys.approvals("item", overlay.value),
    queryFn: ({ signal }) => approvalsApi.get(overlay.value!, signal),
    enabled: Boolean(overlay.value),
  });
  useEffect(() => setComment(""), [overlay.value]);
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") => approvalsApi.decide(overlay.value!, decision, comment.trim()),
    onSuccess: (row) => {
      client.setQueryData(queryKeys.approvals("item", overlay.value), row);
      void client.invalidateQueries({ queryKey: queryKeys.approvals("list") });
      void client.invalidateQueries({ queryKey: queryKeys.notifications("counts") });
      void client.invalidateQueries({ queryKey: queryKeys.time() });
      message.success(`${row.reference} ${row.status.toLowerCase()}`);
    },
    onError: errorToast(message, { action: "decide this" }),
  });
  const withdraw = useMutation({
    mutationFn: () => approvalsApi.withdraw(overlay.value!),
    onSuccess: (row) => {
      client.setQueryData(queryKeys.approvals("item", overlay.value), row);
      void client.invalidateQueries({ queryKey: queryKeys.approvals("list") });
      void client.invalidateQueries({ queryKey: queryKeys.time() });
      message.success("Request withdrawn");
    },
    onError: errorToast(message, { action: "withdraw this" }),
  });
  const item = detail.data;

  return (
    <Drawer
      open={Boolean(overlay.value)}
      onClose={overlay.close}
      width={520}
      rootClassName={URL_OVERLAY}
      title={item ? item.reference : "Request"}
      destroyOnHidden
      data-testid="approval-drawer"
      footer={item?.can_decide ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input.TextArea
            rows={2}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Comment for the requester (required to reject)"
            aria-label="Decision comment"
          />
          <Space wrap>
            <Button type="primary" loading={decide.isPending} onClick={() => decide.mutate("approve")} data-testid="approval-approve">
              Approve
            </Button>
            <Button
              danger
              disabled={!comment.trim()}
              loading={decide.isPending}
              onClick={() => decide.mutate("reject")}
              data-testid="approval-reject"
            >
              Reject
            </Button>
          </Space>
        </Space>
      ) : item?.can_withdraw ? (
        <Popconfirm title="Withdraw this request?" onConfirm={() => withdraw.mutate()}>
          <Button danger>Withdraw request</Button>
        </Popconfirm>
      ) : null}
    >
      {detail.isLoading || !item ? <Skeleton active /> : <DetailBody item={item} />}
    </Drawer>
  );
}

function DetailBody({ item }: { item: ApprovalDetail }) {
  const details = item.details;
  const max = Math.max(1, ...(details.days ?? []).map((day) => day.minutes));
  return (
    <Space direction="vertical" size={18} style={{ width: "100%" }}>
      <div className="nx-td-policy-head">
        <span className="nx-td-row-icon"><KindIcon icon={item.icon} /></span>
        <div style={{ minWidth: 0 }}>
          <h3 className="nx-td-policy-title" data-testid="approval-title">{item.title}</h3>
          <Space size={6} wrap style={{ marginTop: 4 }}>
            <Standing item={item} />
            <span className="nx-td-pilltag nx-td-pilltag--plain">{item.kind_label}</span>
          </Space>
        </div>
      </div>
      {item.summary && <Paragraph className="nx-td-quote">{item.summary}</Paragraph>}
      <dl className="nx-td-facts">
        <dt>Requested by</dt>
        <dd>
          <Space size={6}>
            <PersonAvatar name={item.requester?.name} src={item.requester?.avatar_url} size={22} />
            {item.requester?.name ?? "—"}
          </Space>
        </dd>
        <dt>Asked</dt><dd>{absoluteTime(item.created_at)} ({age(item.age_hours)} ago)</dd>
        <dt>Answer due</dt><dd>{absoluteTime(item.due_at)}</dd>
        {item.assignee && (<><dt>Routed to</dt><dd>{item.assignee.name}</dd></>)}
        {item.subject_label && (
          <>
            <dt>About</dt>
            <dd>{item.link ? <Link to={item.link}>{item.subject_label}</Link> : item.subject_label}</dd>
          </>
        )}
        {(details.facts ?? []).map((fact) => (
          <FactRow key={fact.label} label={fact.label} value={fact.value} />
        ))}
      </dl>
      {details.changes && details.changes.length > 0 && (
        <div>
          <p className="nx-td-section">The change it holds back</p>
          <dl className="nx-td-facts" data-testid="approval-changes">
            {details.changes.map((change) => (
              <FactRow key={change.field} label={change.field} value={`${asText(change.before) || "—"} → ${asText(change.after) || "—"}`} />
            ))}
          </dl>
        </div>
      )}
      {details.days && (
        <div>
          <p className="nx-td-section">The week</p>
          <div className="nx-td-bars" aria-label="Hours per day">
            {details.days.map((day) => (
              <div key={day.date} title={`${dayjs(day.date).format("dddd")}: ${hours(day.minutes)}`}>
                <i style={{ height: `${(day.minutes * 100) / max}%` }} />
                <small>{dayjs(day.date).format("dd")}</small>
              </div>
            ))}
          </div>
          {(details.subjects ?? []).map((subject) => (
            <div key={subject.label} className="nx-td-logged-row" style={{ marginTop: 6 }}>
              <span className="nx-td-faint">{subject.label}</span>
              <b className="nx-td-num">{hours(subject.minutes)}</b>
            </div>
          ))}
        </div>
      )}
      <div>
        <p className="nx-td-section">History</p>
        <ol className="nx-td-history" data-testid="approval-history">
          {item.history.map((event, index) => (
            <li key={`${event.at}-${index}`} className={`is-${event.action}`}>
              <div>
                <Text strong>{event.actor_label || "Somebody"}</Text>{" "}
                <Text type="secondary">{event.action.toLowerCase()} · {relativeTime(event.at)}</Text>
                {event.comment && <p className="nx-td-quote">{event.comment}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Space>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

// ── Rules ─────────────────────────────────────────────────────────────

function RulesView() {
  const { message } = App.useApp();
  const client = useQueryClient();
  const auth = useAuth();
  const [editing, setEditing] = useState<Partial<ChangeRule> | null>(null);
  const rules = useQuery({ queryKey: queryKeys.approvals("rules"), queryFn: ({ signal }) => approvalsApi.rules(signal) });
  const remove = useMutation({
    mutationFn: approvalsApi.deleteRule,
    onSuccess: () => { void client.invalidateQueries({ queryKey: queryKeys.approvals("rules") }); message.success("Rule removed"); },
    onError: errorToast(message, { action: "remove this rule" }),
  });
  const toggle = useMutation({
    mutationFn: (rule: ChangeRule) => approvalsApi.updateRule(rule.id, { active: !rule.active }),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.approvals("rules") }),
    onError: errorToast(message, { action: "change this rule" }),
  });
  if (rules.isLoading) return <Skeleton active />;
  if (rules.isError || !rules.data) return <Alert type="error" showIcon message={errorText(rules.error)} />;
  const data = rules.data;
  const canManage = data.can_manage && auth.can("approvals.decide");
  const describe = (rule: ChangeRule) => {
    const dataset = data.catalogue.find((item) => item.resource_type === rule.resource_type);
    const field = dataset?.fields.find((item) => item.name === rule.field)?.label ?? rule.field;
    const list = Array.isArray(rule.value) ? (rule.value as unknown[]).map(asText).join(", ") : asText(rule.value);
    const op = rule.operator === "ANY" ? "changes at all"
      : rule.operator === "EQUALS" ? `becomes ${list}`
      : rule.operator === "IN" ? `becomes one of ${list}`
      : rule.operator === "GT" ? `goes above ${list}` : `goes below ${list}`;
    return `When a ${dataset?.label.replace(/s$/, "").toLowerCase() ?? rule.resource_type}'s ${field.toLowerCase()} ${op}`;
  };
  return (
    <>
      <div className="nx-td-bar">
        <Text type="secondary" className="nx-td-grow">
          An edit a rule matches is held as a change request until somebody with the approvals permission says yes. People who could approve it themselves are not held up.
        </Text>
        {canManage && <Button type="primary" icon={<NxIcon name="plus" />} onClick={() => setEditing({ operator: "ANY", active: true })}>New rule</Button>}
      </div>
      {data.items.length === 0 ? <div className="nx-td-empty">No rules — every edit applies straight away.</div> : (
        <div className="nx-td-list" data-testid="approval-rules">
          {data.items.map((rule) => (
            <div key={rule.id} className="nx-td-row nx-td-row--nocheck">
              <span className="nx-td-row-icon"><TdIcon name="form" /></span>
              <div className="nx-td-row-main">
                <span className="nx-td-row-title">{rule.name}</span>
                <div className="nx-td-row-meta"><span>{describe(rule)}</span>{rule.description && <span>· {rule.description}</span>}</div>
              </div>
              <div className="nx-td-row-side">
                <Switch checked={rule.active} disabled={!canManage} onChange={() => toggle.mutate(rule)} aria-label={`${rule.name} active`} />
                {canManage && (
                  <>
                    <Button onClick={() => setEditing(rule)}>Edit</Button>
                    <Popconfirm title="Remove this rule?" onConfirm={() => remove.mutate(rule.id)}>
                      <Button danger>Remove</Button>
                    </Popconfirm>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <RuleModal rule={editing} catalogue={data} onClose={() => setEditing(null)} />
    </>
  );
}

function RuleModal({ rule, catalogue, onClose }: { rule: Partial<ChangeRule> | null; catalogue: RuleCatalogue; onClose: () => void }) {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [form] = Form.useForm();
  const resourceType = Form.useWatch("resource_type", form) as string | undefined;
  const fieldName = Form.useWatch("field", form) as string | undefined;
  const operator = Form.useWatch("operator", form) as ChangeRule["operator"] | undefined;
  useEffect(() => {
    if (rule) { form.resetFields(); form.setFieldsValue({ name: "", description: "", ...rule }); }
  }, [rule, form]);
  const dataset = catalogue.catalogue.find((item) => item.resource_type === resourceType);
  const field = dataset?.fields.find((item) => item.name === fieldName);
  const save = useMutation({
    mutationFn: (values: Partial<ChangeRule>) =>
      rule?.id ? approvalsApi.updateRule(rule.id, values) : approvalsApi.createRule(values),
    onSuccess: () => { void client.invalidateQueries({ queryKey: queryKeys.approvals("rules") }); message.success("Rule saved"); onClose(); },
    onError: errorToast(message, { action: "save this rule" }),
  });
  const valueInput = field?.choices.length ? (
    <Select mode={operator === "IN" ? "multiple" : undefined} options={field.choices.map((choice) => ({ value: choice, label: choice }))} />
  ) : field?.kind === "number" ? <InputNumber style={{ width: "100%" }} /> : <Input />;
  return (
    <Modal open={Boolean(rule)} title={rule?.id ? "Edit rule" : "New approval rule"} onCancel={onClose} onOk={() => form.submit()} confirmLoading={save.isPending} forceRender>
      <Form form={form} layout="vertical" onFinish={(values: Partial<ChangeRule>) => save.mutate(values)}>
        <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input placeholder="Large discounts need sign-off" /></Form.Item>
        <Form.Item name="resource_type" label="Dataset" rules={[{ required: true }]}>
          <Select options={catalogue.catalogue.map((item) => ({ value: item.resource_type, label: item.label }))} onChange={() => form.setFieldValue("field", undefined)} />
        </Form.Item>
        <Form.Item name="field" label="Field" rules={[{ required: true }]}>
          <Select options={(dataset?.fields ?? []).map((item) => ({ value: item.name, label: item.label }))} disabled={!dataset} />
        </Form.Item>
        <Form.Item name="operator" label="Hold the edit when the new value…" rules={[{ required: true }]}>
          <Select options={[
            { value: "ANY", label: "…is anything different" }, { value: "EQUALS", label: "…equals" },
            { value: "IN", label: "…is one of" }, { value: "GT", label: "…is greater than" }, { value: "LT", label: "…is less than" },
          ]} />
        </Form.Item>
        {operator && operator !== "ANY" && <Form.Item name="value" label="Value" rules={[{ required: true }]}>{valueInput}</Form.Item>}
        <Form.Item name="description" label="Why (shown to the requester)"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
