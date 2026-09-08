/**
 * One evaluation, rendered (§49).
 *
 * The four numbers are the point, and they are four rather than one because
 * "it matched eleven and did nothing" has three different explanations that a
 * single count hides: nine were already told recently, two are waiting for the
 * next pass, or the actions failed. An automation nobody can read is an
 * automation nobody trusts, and then somebody rebuilds it in a spreadsheet.
 *
 * `suppressed` gets the most careful wording, because it is the number that
 * looks like a failure and is the feature working: the cooldown is held per
 * record, so a second run over the same breaches is *supposed* to be quiet.
 *
 * Shared by the drawer and by the wizard's rehearsal step: the reader is
 * asking the same question in both places, and the point of a dry run is that
 * it looks like the real thing.
 */

import { Alert, Empty, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link } from "react-router-dom";

import type { AutomationOutcome, AutomationRun } from "@/api/automations";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text } = Typography;

/** What each state is called and why, in the one place that decides it. */
const STATE: Record<AutomationOutcome["state"], { colour?: string; hint: string }> = {
  FIRED: { colour: "success", hint: "Its actions ran on this record." },
  "WOULD FIRE": { colour: "processing", hint: "Nothing has been sent — this was a rehearsal." },
  SUPPRESSED: {
    colour: undefined,
    hint: "Acted on recently, so the cooldown held it back. This is the cooldown working.",
  },
};

export function RunReport({ run, dense }: { run: AutomationRun; dense?: boolean }) {
  const columns: ColumnsType<AutomationOutcome> = [
    {
      title: "Record",
      dataIndex: "record",
      ellipsis: true,
      render: (label: string, row) => (
        // A link, because the first thing anybody does with a match is go and
        // look at it (§66).
        <Link to={row.path} className="nu-run-record">
          {label}
        </Link>
      ),
    },
    {
      title: "State",
      dataIndex: "state",
      width: 132,
      render: (state: AutomationOutcome["state"], row) => (
        <Tooltip
          title={
            state === "SUPPRESSED" && row.since
              ? `Last acted on ${relativeTime(row.since)}`
              : STATE[state].hint
          }
        >
          <Tag color={STATE[state].colour} bordered={false}>
            {state.toLowerCase()}
          </Tag>
        </Tooltip>
      ),
    },
    {
      title: "What happened",
      key: "actions",
      render: (_value: unknown, row) =>
        row.actions.length === 0 ? (
          <Text type="secondary">—</Text>
        ) : (
          <Space size={6} wrap>
            {row.actions.map((item, index) => (
              <Tag
                key={`${item.kind}-${index}`}
                color={item.ok ? undefined : "error"}
                bordered={false}
              >
                {item.kind.toLowerCase()}
                {item.detail ? ` · ${item.detail}` : ""}
              </Tag>
            ))}
          </Space>
        ),
    },
  ];

  return (
    <Space direction="vertical" size={12} className="nu-block" data-testid="run-report">
      {/* The evaluation itself failed — a condition naming a field that has
          since been renamed, say. Distinct from an action failing, and shown
          first because nothing below it means anything. */}
      {run.error && (
        <Alert
          type="error"
          showIcon
          message="This automation could not be evaluated"
          description={run.error}
        />
      )}

      <div className="nu-run-numbers">
        <Number label="Matched" value={run.matched} />
        <Number
          label={run.dry_run ? "Would fire" : "Fired"}
          value={run.fired}
          tone={run.fired > 0 ? "strong" : undefined}
        />
        <Number
          label="Held back"
          value={run.suppressed}
          hint="Matched, and acted on recently enough that the cooldown kept quiet."
        />
        {run.deferred > 0 && (
          <Number
            label="Next run"
            value={run.deferred}
            hint="Over this run's limit. Nothing recorded a cooldown for them, so the next run picks them up."
          />
        )}
      </div>

      {run.capped && (
        <Alert
          type="warning"
          showIcon
          message="This automation matches more records than one run will look at"
          description="Narrow the condition: a rule that matches most of a table is a rule that will be ignored."
        />
      )}

      {run.finished_at && (
        // Relative in the sentence, absolute on hover. Printing both was
        // saying the same thing twice, and the tooltip is what a timestamp is
        // for — nobody reads "01:52:30 p.m." to mean "just now".
        <Tooltip title={absoluteTime(run.finished_at)}>
          <Text type="secondary">
            {run.dry_run ? "Rehearsed" : "Ran"} {relativeTime(run.finished_at)}
            {run.triggered_by ? ` · ${run.triggered_by}` : ""}
          </Text>
        </Tooltip>
      )}

      {run.sample.length === 0 ? (
        <Empty
          image={null}
          description={
            run.matched === 0
              ? "Nothing matched. That is the quiet answer, not an error."
              : "No detail was kept for this run."
          }
        />
      ) : (
        <Table<AutomationOutcome>
          rowKey="record_id"
          size="small"
          pagination={false}
          dataSource={run.sample}
          columns={columns}
          scroll={dense ? { y: 240 } : undefined}
          data-testid="run-sample"
        />
      )}

      {run.matched > run.sample.length && (
        <Text type="secondary">
          Showing the first {run.sample.length} of {run.matched}.
        </Text>
      )}
    </Space>
  );
}

function Number({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "strong";
}) {
  const body = (
    <div className="nu-run-number">
      <Text className={tone === "strong" ? "nu-run-number-value nu-run-number-value--strong" : "nu-run-number-value"}>
        {value}
      </Text>
      <Text type="secondary" className="nu-run-number-label">
        {label}
      </Text>
    </div>
  );
  return hint ? <Tooltip title={hint}>{body}</Tooltip> : body;
}
