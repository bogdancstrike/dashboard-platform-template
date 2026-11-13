import type { ComponentType } from "react";
import { Alert, Space, Table, Tag, Tooltip, Typography } from "antd";

import type { AutomationAction, AutomationCatalogue, AutomationRun } from "@/api/automations";
import { AdvancedQueryBuilder } from "@/components/explorer/AdvancedQueryBuilder";
import type { QueryNode } from "@/components/explorer/queryTree";
import { absoluteTime, relativeTime } from "@/lib/time";

import { ActionListEditor } from "../ActionListEditor";
import { RunReport } from "../RunReport";
import type { useAutomationDrawer } from "./useAutomationDrawer";

const { Text } = Typography;

type Drawer = ReturnType<typeof useAutomationDrawer>;

interface SectionProps {
  drawer: Drawer;
  catalogue: AutomationCatalogue;
}

/** The condition, edited with the advanced search's builder, beside the server's rendering of it. */
function ConditionSection({ drawer }: SectionProps) {
  const { resource, write } = drawer;
  const detail = drawer.detail!;
  return (
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
  );
}

function ActionsSection({ drawer, catalogue }: SectionProps) {
  const { canEdit, write } = drawer;
  return (
    <ActionListEditor
      catalogue={catalogue}
      value={drawer.detail!.actions}
      disabled={!canEdit || write.isPending}
      onChange={(actions: AutomationAction[]) => write.mutate({ actions })}
    />
  );
}

function RunsSection({ drawer }: SectionProps) {
  const { latest } = drawer;
  const detail = drawer.detail!;
  return (
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
function CoolingDownTable({
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

function QuietSection({ drawer }: SectionProps) {
  return <CoolingDownTable detail={drawer.detail!} />;
}

/** The drawer's sections, keyed as the switcher above them names them. */
export const SECTIONS: Record<string, ComponentType<SectionProps>> = {
  condition: ConditionSection,
  actions: ActionsSection,
  runs: RunsSection,
  quiet: QuietSection,
};
