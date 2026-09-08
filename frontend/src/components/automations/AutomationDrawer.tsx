/**
 * An automation, opened (§49, §51).
 *
 * A drawer rather than a route, for the reason the kanban card is one: a rule
 * is read *against the others*. "Is something else already watching this?" is
 * half of why it was opened, and a page would take the list off screen.
 *
 * Three decisions worth stating.
 *
 * **Dry run is the primary action, and it is always available.** Including on
 * a paused rule, because reading what it *would* do is how somebody decides
 * whether to switch it on — and refusing that is refusing the only safe way to
 * find out. Firing for real sits behind it and says what it will do.
 *
 * **The condition is edited, and the compiled text is shown beside it.** The
 * text comes from the server, rendered by the same module that compiles the
 * tree, so the sentence a reader checks against is provably the shape of the
 * SQL that will run (§51). A rendering computed in the browser would be a
 * second opinion.
 *
 * **What it is holding back is on the page, not inferred.** A rule that has
 * gone quiet is the commonest support question an automation feature has, and
 * the answer — these nine records, until this time — is a fact the server
 * derives from the ledger and the current cooldown.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Drawer,
  Input,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, PlayCircleOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  automationsApi,
  type AutomationAction,
  type AutomationCatalogue,
  type AutomationInput,
  type AutomationRun,
} from "@/api/automations";
import { ApiError } from "@/api/client";
import { explorerApi } from "@/api/explorer";
import { AdvancedQueryBuilder } from "@/components/explorer/AdvancedQueryBuilder";
import type { QueryNode } from "@/components/explorer/queryTree";
import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { ActionListEditor } from "@/components/automations/ActionListEditor";
import { RunReport } from "@/components/automations/RunReport";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text, Title } = Typography;

/** The cooldowns worth offering, with what each one means for the noise. */
const COOLDOWNS = [
  { value: 0, label: "Every run" },
  { value: 15, label: "15 minutes" },
  { value: 60, label: "1 hour" },
  { value: 240, label: "4 hours" },
  { value: 1440, label: "1 day" },
];

export function AutomationDrawer({
  ruleId,
  catalogue,
  onClose,
  onChanged,
}: {
  ruleId: string | null;
  catalogue: AutomationCatalogue;
  onClose: () => void;
  /** The list behind the drawer has to hear about every write. */
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [tab, setTab] = useState("condition");
  const [latest, setLatest] = useState<AutomationRun | null>(null);

  const rule = useQuery({
    queryKey: ["automation", ruleId],
    queryFn: ({ signal }) => automationsApi.get(ruleId!, signal),
    enabled: Boolean(ruleId),
  });

  const detail = rule.data;
  const canEdit = detail?.can_edit ?? false;

  // The field catalogue for the dataset this rule watches — the same one the
  // advanced search builder is configured from, so the two editors offer
  // exactly the same fields and operators.
  const fields = useQuery({
    queryKey: ["explorer-catalogue"],
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: 60_000,
  });
  const resource = fields.data?.items.find((item) => item.key === detail?.resource_type);

  // A fresh drawer starts on the condition, and a fresh rule starts with no
  // run on screen — a report left over from the previous rule would be read
  // as this one's.
  useEffect(() => {
    setTab("condition");
    setLatest(null);
  }, [ruleId]);

  const write = useMutation({
    mutationFn: (input: AutomationInput) => automationsApi.update(ruleId!, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["automation", ruleId], (current: typeof detail) =>
        current ? { ...current, ...updated } : current,
      );
      onChanged();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That change was refused."),
  });

  const evaluate = useMutation({
    mutationFn: (dryRun: boolean) => automationsApi.run(ruleId!, dryRun),
    onSuccess: (answer) => {
      setLatest(answer);
      setTab("runs");
      // Refetched either way: a rehearsal is recorded too, and the history
      // below the report would otherwise be missing the run above it. Only a
      // real one changes the *list* behind the drawer.
      void rule.refetch();
      if (!answer.dry_run) onChanged();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That run was refused."),
  });

  const remove = useMutation({
    mutationFn: () => automationsApi.remove(ruleId!),
    onSuccess: () => {
      message.success("Automation withdrawn");
      onChanged();
      onClose();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That could not be withdrawn."),
  });

  return (
    <Drawer
      open={ruleId !== null}
      width={760}
      onClose={onClose}
      title={
        detail ? (
          <Space size={8}>
            <Tag color={detail.enabled ? "success" : undefined} bordered={false}>
              {detail.enabled ? "Live" : "Paused"}
            </Tag>
            <Text>{detail.name}</Text>
          </Space>
        ) : (
          "Automation"
        )
      }
      extra={
        detail && (
          <Space size={8}>
            <Button
              icon={<PlayCircleOutlined />}
              loading={evaluate.isPending}
              onClick={() => evaluate.mutate(true)}
              data-testid="dry-run"
            >
              Dry run
            </Button>
            {canEdit && (
              <Tooltip
                title={
                  detail.enabled
                    ? "Runs the actions for real, on everything not in cooldown."
                    : "Enable it first — a paused automation does not fire."
                }
              >
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  disabled={!detail.enabled}
                  loading={evaluate.isPending}
                  onClick={() =>
                    modal.confirm({
                      title: "Run it for real?",
                      content:
                        "Its actions will run on every matching record that is not in cooldown — notifications sent, tasks raised, webhooks called.",
                      okText: "Run it",
                      onOk: () => evaluate.mutateAsync(false),
                    })
                  }
                  data-testid="run-for-real"
                >
                  Run now
                </Button>
              </Tooltip>
            )}
          </Space>
        )
      }
    >
      {rule.isLoading || !detail ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : (
        <Space direction="vertical" size={16} className="nu-block">
          <div className="nu-automation-head">
            <Title level={5} className="nu-automation-title">
              {canEdit ? (
                <Input
                  defaultValue={detail.name}
                  aria-label="Name"
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (value && value !== detail.name) write.mutate({ name: value });
                  }}
                />
              ) : (
                detail.name
              )}
            </Title>
            <Space size={12}>
              <Text type="secondary">
                Watches{" "}
                <Link to={detail.resource_path}>{detail.resource_label.toLowerCase()}</Link>
              </Text>
              {canEdit && (
                <Switch
                  checked={detail.enabled}
                  loading={write.isPending}
                  aria-label="Enabled"
                  onChange={(enabled) => write.mutate({ enabled })}
                  data-testid="toggle-enabled"
                />
              )}
            </Space>
          </div>

          {/* Written on change like the task page's triage controls: an
              automation whose severity is wrong is not worth a form. */}
          <div className="nu-automation-grid">
            <Field label="Severity">
              <Select
                aria-label="Severity"
                value={detail.severity}
                disabled={!canEdit}
                onChange={(severity: string) =>
                  write.mutate({ severity: severity as typeof detail.severity })
                }
                options={catalogue.severities.map((item) => ({
                  value: item,
                  label: item.charAt(0) + item.slice(1).toLowerCase(),
                }))}
              />
            </Field>

            <Field
              label="Say it again after"
              hint="Held per record: a second run is quiet about records it has already acted on, not about the whole rule."
            >
              <Select
                aria-label="Cooldown"
                value={detail.cooldown_minutes}
                disabled={!canEdit}
                onChange={(minutes: number) => write.mutate({ cooldown_minutes: minutes })}
                options={COOLDOWNS}
              />
            </Field>

            <Field
              label="Meant to run"
              hint="Stored, and nothing runs it unattended yet — press Run now, or wait for scheduled jobs."
            >
              <Input
                aria-label="Schedule"
                className="nu-mono"
                defaultValue={detail.schedule}
                disabled={!canEdit}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value && value !== detail.schedule) write.mutate({ schedule: value });
                }}
              />
            </Field>

            <Field label="Fired in total">
              <Text data-testid="fired-total">
                {detail.trigger_count}
                {detail.last_triggered_at ? (
                  <Tooltip title={absoluteTime(detail.last_triggered_at)}>
                    <span> · last {relativeTime(detail.last_triggered_at)}</span>
                  </Tooltip>
                ) : null}
              </Text>
            </Field>
          </div>

          <Segmented
            aria-label="Section"
            value={tab}
            onChange={(next) => setTab(String(next))}
            options={[
              { value: "condition", label: "When" },
              { value: "actions", label: `Then (${detail.actions.length})` },
              { value: "runs", label: "Runs" },
              { value: "quiet", label: `Held back (${detail.cooling_down.length})` },
            ]}
            block
            data-testid="automation-section"
          />

          {tab === "condition" && (
            <Space direction="vertical" size={12} className="nu-block">
              {resource ? (
                <AdvancedQueryBuilder
                  fields={resource.fields}
                  value={detail.condition_tree}
                  onChange={(tree: QueryNode) => write.mutate({ condition_tree: tree })}
                />
              ) : (
                <Alert
                  type="warning"
                  showIcon
                  message={`Nothing here can watch ${detail.resource_type}`}
                  description="The dataset this automation names is no longer one the platform explores, so its condition cannot be edited. It has been paused."
                />
              )}

              {/* The server's rendering of the tree, not the browser's: the
                  point of an inspector is that it cannot disagree with the
                  SQL (§51). */}
              <div>
                <Text strong className="nu-field-label">
                  What that compiles to
                </Text>
                <pre className="nu-condition-text" data-testid="condition-text">
                  {detail.condition_text || "Nothing — an automation with no condition matches no records."}
                </pre>
              </div>
            </Space>
          )}

          {tab === "actions" && (
            <ActionListEditor
              catalogue={catalogue}
              value={detail.actions}
              disabled={!canEdit || write.isPending}
              onChange={(actions: AutomationAction[]) => write.mutate({ actions })}
            />
          )}

          {tab === "runs" && (
            <Space direction="vertical" size={16} className="nu-block">
              {latest && <RunReport run={latest} dense />}
              {!latest && detail.runs.length === 0 && (
                <Alert
                  type="info"
                  showIcon
                  message="This automation has never run"
                  description="Press Dry run to see what it would do to the records that exist right now."
                />
              )}
              {detail.runs.length > 0 && <RunHistory runs={detail.runs} />}
            </Space>
          )}

          {tab === "quiet" && <CoolingDown detail={detail} />}

          <div>
            <Text strong className="nu-field-label">
              History
            </Text>
            <AuditTimeline resourceType="alert_rule" resourceId={detail.id} limit={8} />
          </div>

          {canEdit && (
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={remove.isPending}
              onClick={() =>
                modal.confirm({
                  title: `Withdraw ${detail.name}?`,
                  content:
                    "It stops watching immediately. Its run history is kept, and nothing it has already sent is undone.",
                  okText: "Withdraw",
                  okButtonProps: { danger: true },
                  onOk: () => remove.mutateAsync(),
                })
              }
              data-testid="delete-automation"
            >
              Withdraw this automation
            </Button>
          )}
        </Space>
      )}
    </Drawer>
  );
}

/** Past evaluations, as a table rather than a feed: they are being compared. */
function RunHistory({ runs }: { runs: AutomationRun[] }) {
  return (
    <div>
      <Text strong className="nu-field-label">
        Earlier runs
      </Text>
      <Table<AutomationRun>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={runs}
        data-testid="run-history"
        columns={[
          {
            title: "When",
            dataIndex: "started_at",
            render: (value: string | null) =>
              value ? (
                <Tooltip title={absoluteTime(value)}>
                  <span>{relativeTime(value)}</span>
                </Tooltip>
              ) : (
                "—"
              ),
          },
          {
            title: "Kind",
            dataIndex: "dry_run",
            width: 96,
            render: (dryRun: boolean) => (
              <Tag bordered={false}>{dryRun ? "rehearsal" : "live"}</Tag>
            ),
          },
          { title: "Matched", dataIndex: "matched", width: 88, align: "end" },
          { title: "Fired", dataIndex: "fired", width: 76, align: "end" },
          { title: "Held back", dataIndex: "suppressed", width: 96, align: "end" },
          {
            title: "",
            dataIndex: "error",
            width: 40,
            render: (error: string | null) =>
              error ? (
                <Tooltip title={error}>
                  <Tag color="error" bordered={false}>
                    !
                  </Tag>
                </Tooltip>
              ) : null,
          },
        ]}
      />
    </div>
  );
}

/**
 * What the rule is currently silent about.
 *
 * The answer to "why has it gone quiet", which is the question a working
 * automation gets asked most. Derived on the server from the ledger and the
 * *current* cooldown, so shortening the cooldown empties this list at once.
 */
function CoolingDown({
  detail,
}: {
  detail: { cooling_down: Array<{ record_id: string; record: string | null; until: string | null; fire_count: number }>; cooldown_minutes: number };
}) {
  if (detail.cooldown_minutes === 0) {
    return (
      <Alert
        type="info"
        showIcon
        message="This automation has no cooldown"
        description="It acts on every match, every run. Nothing is ever held back."
      />
    );
  }
  if (detail.cooling_down.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        message="Nothing is being held back"
        description="Every matching record is free to be acted on the next time this runs."
      />
    );
  }
  return (
    <Table
      rowKey="record_id"
      size="small"
      pagination={false}
      dataSource={detail.cooling_down}
      data-testid="cooling-down"
      columns={[
        { title: "Record", dataIndex: "record", ellipsis: true },
        {
          title: "Quiet until",
          dataIndex: "until",
          width: 160,
          render: (value: string | null) =>
            value ? (
              <Tooltip title={absoluteTime(value)}>
                <span>{relativeTime(value)}</span>
              </Tooltip>
            ) : (
              "—"
            ),
        },
        { title: "Times", dataIndex: "fire_count", width: 76, align: "end" },
      ]}
    />
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const body = (
    <Text strong className="nu-field-label">
      {label}
    </Text>
  );
  return (
    <div>
      {hint ? <Tooltip title={hint}>{body}</Tooltip> : body}
      {children}
    </div>
  );
}
