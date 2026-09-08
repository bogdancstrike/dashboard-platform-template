/**
 * `/workflows` — condition → action automation (§49).
 *
 * A table, filling the window, because the reader's question is comparative:
 * *what is watching what, and is any of it firing?* Cards would put four rules
 * on a screen and hide the column that answers it. The rule itself opens in a
 * drawer, so the list stays behind it — "is something else already watching
 * this?" is half of why a rule gets opened.
 *
 * Three decisions worth stating.
 *
 * **The loud column is the one that says whether it works.** Not the name and
 * not the schedule: a rule that has never fired and a rule that fired forty
 * times yesterday need completely different attention, and that is the fact
 * that goes next to the state. The tracker's ticket queue learned the same
 * lesson from the other direction — a column that is loud about something
 * every row shares says nothing at all.
 *
 * **"Paused" is a switch in the row, not a menu item.** Stopping a noisy
 * automation is the single most urgent thing anybody does on this page, and it
 * should never be three clicks deep.
 *
 * **The condition is shown as the server rendered it.** One line, ellipsised,
 * from `describe_tree` — so the sentence in the list is provably the shape of
 * the SQL the rule runs (§51), and not a summary the browser invented.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Dropdown,
  Empty,
  Segmented,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { automationsApi, type AutomationRule } from "@/api/automations";
import { ApiError } from "@/api/client";
import { AutomationDrawer } from "@/components/automations/AutomationDrawer";
import { AutomationWizard } from "@/components/automations/AutomationWizard";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text } = Typography;

const SEVERITY_COLOUR: Record<string, string | undefined> = {
  CRITICAL: "error",
  WARNING: "warning",
  INFO: undefined,
};

/**
 * How a rule is doing, in words.
 *
 * Pure and exported so the test can state the rule without a table: "never
 * fired" and "fired 40 times, last 2h ago" are the two states this page exists
 * to distinguish, and a rule that is enabled but has never matched anything is
 * the one worth a second look.
 */
export function firingSummary(rule: AutomationRule): { text: string; quiet: boolean } {
  if (rule.trigger_count === 0) {
    return {
      text: rule.enabled ? "Never fired" : "Never fired · paused",
      // Quiet is not the same as broken — a rule guarding against something
      // rare *should* be silent — so this is a tone, not a warning.
      quiet: true,
    };
  }
  const times = `${rule.trigger_count} time${rule.trigger_count === 1 ? "" : "s"}`;
  return {
    text: rule.last_triggered_at
      ? `${times} · last ${relativeTime(rule.last_triggered_at)}`
      : times,
    quiet: false,
  };
}

export default function WorkflowsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [creating, setCreating] = useState(false);

  const state = params.get("state") ?? "";
  const open = params.get("rule");

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

  const catalogue = useQuery({
    queryKey: ["automation-catalogue"],
    queryFn: ({ signal }) => automationsApi.catalogue(signal),
    staleTime: 60_000,
  });

  const rules = useQuery({
    queryKey: ["automations", state],
    queryFn: ({ signal }) => automationsApi.list({ state }, signal),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["automations"] });
    void queryClient.invalidateQueries({ queryKey: ["automation", open] });
  };

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      automationsApi.update(id, { enabled }),
    onSuccess: (rule) => {
      message.success(rule.enabled ? `${rule.name} is live` : `${rule.name} is paused`);
      refresh();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That change was refused."),
  });

  const rehearse = useMutation({
    mutationFn: (id: string) => automationsApi.run(id, true),
    onSuccess: (run) =>
      message.info(
        run.error
          ? "That automation could not be evaluated — open it to see why."
          : `${run.matched} matched, ${run.fired} would fire, ${run.suppressed} held back.`,
      ),
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That run was refused."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => automationsApi.remove(id),
    onSuccess: () => {
      message.success("Automation withdrawn");
      refresh();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That could not be withdrawn."),
  });

  usePageCommands("workflows", [
    {
      id: "workflows.new",
      label: "Write an automation",
      keywords: "rule alert automation trigger notify",
      run: () => setCreating(true),
    },
    {
      id: "workflows.paused",
      label: "Show automations that are paused",
      keywords: "off disabled stopped",
      run: () => set({ state: "PAUSED" }),
    },
  ]);

  if (rules.isLoading || catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (rules.isError || catalogue.isError) {
    const error = rules.error ?? catalogue.error;
    return (
      <>
        <PageHeader title="Automations" />
        <Alert
          type="error"
          showIcon
          message={
            error instanceof ApiError ? error.message : "Automations could not be loaded."
          }
          action={
            <Button size="small" onClick={() => void rules.refetch()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  const rows = rules.data?.items ?? [];
  const counts = rules.data?.counts;

  const columns: ColumnsType<AutomationRule> = [
    {
      title: "Automation",
      dataIndex: "name",
      ellipsis: true,
      render: (name: string, row) => (
        <div className="nu-flow-cell">
          <button
            type="button"
            className="nu-link-button"
            onClick={() => set({ rule: row.id })}
            data-testid={`open-${row.id}`}
          >
            {name}
          </button>
          {/* The compiled condition, one line — the server's rendering, so it
              cannot describe a different query from the one that runs (§51). */}
          <Tooltip title={row.condition_text || "No condition"}>
            <Text type="secondary" className="nu-flow-condition" ellipsis>
              {oneLine(row.condition_text) || "No condition — matches nothing"}
            </Text>
          </Tooltip>
        </div>
      ),
    },
    {
      title: "Live",
      key: "enabled",
      width: 76,
      render: (_value: unknown, row) => (
        // A switch in the row: stopping a noisy automation is the most urgent
        // thing on this page and must never be three clicks deep.
        <Tooltip title={row.can_edit ? undefined : "Only its author can change this."}>
          <Switch
            size="small"
            checked={row.enabled}
            disabled={!row.can_edit || toggle.isPending}
            aria-label={`${row.enabled ? "Pause" : "Enable"} ${row.name}`}
            onChange={(enabled) => toggle.mutate({ id: row.id, enabled })}
          />
        </Tooltip>
      ),
    },
    {
      title: "Watches",
      dataIndex: "resource_label",
      width: 136,
      ellipsis: true,
      render: (label: string, row) =>
        row.resource_exists ? (
          label
        ) : (
          // The one fact that explains everything else about this row. Said
          // here rather than left to be inferred from an empty action list.
          <Tooltip title="This dataset is no longer one the platform explores, so the automation was paused. Withdraw it, or point it at something that exists.">
            <Tag color="warning" bordered={false}>
              {label} · gone
            </Tag>
          </Tooltip>
        ),
    },
    {
      title: "Severity",
      dataIndex: "severity",
      width: 108,
      render: (severity: string) => (
        <Tag color={SEVERITY_COLOUR[severity]} bordered={false} className="nu-mono-tag">
          {severity.toLowerCase()}
        </Tag>
      ),
    },
    {
      title: "Does",
      key: "actions",
      width: 196,
      render: (_value: unknown, row) =>
        row.action_summary.length === 0 ? (
          // Refused on save, so an *enabled* rule with no action is worth
          // shouting about. On a rule whose dataset is gone it is a symptom of
          // something the row already says, and shouting twice about one fact
          // is how a page teaches people to ignore its warnings.
          <Text type={row.resource_exists ? "danger" : "secondary"}>Nothing</Text>
        ) : (
          <Space size={4} wrap>
            {row.action_summary.map((label, index) => (
              <Tag key={`${label}-${index}`} bordered={false}>
                {label}
              </Tag>
            ))}
          </Space>
        ),
    },
    {
      title: "Quiet for",
      dataIndex: "cooldown_minutes",
      width: 104,
      render: (minutes: number) => (
        <Tooltip title="Held per record, so a second run is quiet about records it already acted on — not about the whole rule.">
          <Text type="secondary">{cooldownLabel(minutes)}</Text>
        </Tooltip>
      ),
    },
    {
      // The column that says whether the thing works, next to the state —
      // which is the pairing a reader is actually scanning for.
      title: "Firing",
      key: "firing",
      width: 200,
      render: (_value: unknown, row) => {
        const summary = firingSummary(row);
        return (
          <Tooltip
            title={
              row.last_triggered_at
                ? absoluteTime(row.last_triggered_at)
                : "It has matched nothing since it was written. For a rare event that is the right answer."
            }
          >
            <Text type={summary.quiet ? "secondary" : undefined}>{summary.text}</Text>
          </Tooltip>
        );
      },
    },
    {
      title: "",
      key: "menu",
      width: 48,
      align: "end",
      render: (_value: unknown, row) => (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              {
                key: "dry",
                icon: <PlayCircleOutlined />,
                label: "Dry run",
                onClick: () => rehearse.mutate(row.id),
              },
              ...(row.can_edit
                ? [
                    { type: "divider" as const },
                    {
                      key: "delete",
                      icon: <DeleteOutlined />,
                      danger: true,
                      label: "Withdraw",
                      onClick: () =>
                        modal.confirm({
                          title: `Withdraw ${row.name}?`,
                          content:
                            "It stops watching immediately. Its history is kept, and nothing it has already sent is undone.",
                          okText: "Withdraw",
                          okButtonProps: { danger: true },
                          onOk: () => remove.mutateAsync(row.id),
                        }),
                    },
                  ]
                : []),
            ],
          }}
        >
          <Button type="text" icon={<MoreOutlined />} aria-label={`Actions for ${row.name}`} />
        </Dropdown>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Automations"
        subtitle="When records look like this, do these things — on the same conditions the advanced search builds."
        tag={
          counts ? (
            <Tag color={counts.enabled > 0 ? "blue" : undefined}>
              {counts.enabled} of {counts.total} live
            </Tag>
          ) : undefined
        }
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreating(true)}
            data-testid="new-automation"
          >
            Write one
          </Button>
        }
      />

      {rows.length === 0 && !state ? (
        <EmptyState
          title="Nothing is watching anything yet"
          hint="An automation is one sentence: when records look like this, notify somebody, raise a task, or call a webhook. It is created paused, and rehearsed before it fires."
          action={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              Write the first one
            </Button>
          }
        />
      ) : (
        // Filling the window rather than ending where the rows do (§20).
        <div className="nu-fill">
          <Card
            size="small"
            className="nu-pane nu-pane--table"
            data-testid="automation-list"
            title={
              <Segmented
                aria-label="State"
                value={state || "all"}
                onChange={(next) => set({ state: next === "all" ? null : String(next) })}
                options={[
                  { value: "all", label: `Everything (${counts?.total ?? 0})` },
                  { value: "ENABLED", label: `Live (${counts?.enabled ?? 0})` },
                  { value: "PAUSED", label: "Paused" },
                ]}
              />
            }
          >
            <Table<AutomationRule>
              rowKey="id"
              size="small"
              sticky
              columns={columns}
              dataSource={rows}
              pagination={false}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="Nothing in this state"
                  />
                ),
              }}
            />
          </Card>
        </div>
      )}

      {catalogue.data && (
        <AutomationWizard
          open={creating}
          catalogue={catalogue.data}
          onClose={() => setCreating(false)}
          onCreated={(rule) => {
            setCreating(false);
            refresh();
            // Straight into the drawer: it was created paused, and switching
            // it on is the next thing the reader wants to do.
            set({ rule: rule.id });
          }}
        />
      )}

      {catalogue.data && (
        <AutomationDrawer
          ruleId={open}
          catalogue={catalogue.data}
          onClose={() => set({ rule: null })}
          onChanged={refresh}
        />
      )}
    </>
  );
}

/** The compiled condition on one line, for a table cell. */
function oneLine(text: string | null): string {
  return (text ?? "").split("\n").map((part) => part.trim()).filter(Boolean).join(" ");
}

function cooldownLabel(minutes: number): string {
  if (minutes === 0) return "every run";
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  return `${Math.round(minutes / 60)} h`;
}
