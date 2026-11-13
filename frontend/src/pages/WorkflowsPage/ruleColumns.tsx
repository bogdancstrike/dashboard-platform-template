import { Button, Dropdown, Space, Switch, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, MoreOutlined, PlayCircleOutlined } from "@ant-design/icons";

import type { AutomationRule } from "@/api/automations";
import { NxIcon } from "@/components/NxIcon";
import { StatusTag } from "@/components/StatusTag";
import { absoluteTime } from "@/lib/time";

import { cooldownLabel, firingSummary, oneLine } from "./ruleCopy";
import type { useWorkflowsPage } from "./useWorkflowsPage";

const { Text } = Typography;

type Page = ReturnType<typeof useWorkflowsPage>;

/** What a rule watches, how loud it is, what it does, how quiet it stays, and whether it works. */
const RULE_FACTS: ColumnsType<AutomationRule> = [
  {
    title: "Watches",
    dataIndex: "resource_label",
    width: 136,
    ellipsis: true,
    render: (label: string, row) =>
      row.resource_exists ? (
        <StatusTag status={label} tone="acc" label={label} />
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
      <StatusTag
        status={severity}
        tone={severity === "CRITICAL" ? "bad" : severity === "WARNING" ? "warn" : "acc"}
      />
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
];

/** The automations table: the name opens it, the switch pauses it, the menu acts on it. */
export function ruleColumns(page: Page): ColumnsType<AutomationRule> {
  const { set, toggle } = page;
  return [
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
          {row.trigger && (
            <span className="nx-wf-trigger" data-testid={`trigger-${row.id}`}>
              <NxIcon name="flow" size={12} />
              {row.trigger.text}
              {(row.version ?? 0) > 0 && ` · v${row.version}`}
              {row.has_draft && " · draft"}
            </span>
          )}
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
    ...RULE_FACTS,
    {
      title: "",
      key: "menu",
      width: 48,
      align: "end",
      render: (_value: unknown, row) => <RuleMenu row={row} page={page} />,
    },
  ];
}

function RuleMenu({ row, page }: { row: AutomationRule; page: Page }) {
  const { canvasOn, navigate, rehearse, modal, remove } = page;
  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        items: [
          ...(canvasOn
            ? [{
                key: "canvas",
                icon: <NxIcon name="flow" size={14} />,
                label: "Open on canvas",
                onClick: () => navigate(`/workflows/${row.id}/canvas`),
              }]
            : []),
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
  );
}
