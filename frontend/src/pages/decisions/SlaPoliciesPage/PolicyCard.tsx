import { Button, Card, Space, Switch, Tooltip, Typography } from "antd";

import { target, type SlaCatalogue, type SlaPolicy } from "@/api/sla";
import { TdIcon } from "@/components/icons/TdIcon";

import { ACTION_LABEL, PRIORITIES, TARGET_LABEL, conditionLabels, words } from "./slaCopy";

const { Text } = Typography;

interface PolicyCardProps {
  policy: SlaPolicy;
  index: number;
  count: number;
  catalogue: SlaCatalogue | undefined;
  canManage: boolean;
  onToggle: () => void;
  onMove: (delta: number) => void;
  onEdit: () => void;
}

/** One policy: its rank, the tickets it matches, its targets, and what happens when they slip. */
export function PolicyCard({ policy, index, count, catalogue, canManage, onToggle, onMove, onEdit }: PolicyCardProps) {
  return (
    <Card className="nx-td-policy" data-testid="sla-policy">
      <div className="nx-td-policy">
        <div className="nx-td-policy-head">
          <span className="nx-td-policy-rank">{index + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 className="nx-td-policy-title">{policy.name}</h3>
            <Text type="secondary">{policy.description}</Text>
          </div>
          <Space wrap>
            <Switch checked={policy.active} disabled={!canManage} onChange={onToggle} aria-label={`${policy.name} active`} />
            {canManage && (
              <>
                <Tooltip title="Evaluate earlier"><Button disabled={index === 0} onClick={() => onMove(-1)} icon={<TdIcon name="up" />} aria-label="Move up" /></Tooltip>
                <Tooltip title="Evaluate later"><Button disabled={index === count - 1} onClick={() => onMove(1)} icon={<TdIcon name="up" style={{ transform: "rotate(180deg)" }} />} aria-label="Move down" /></Tooltip>
                <Button onClick={onEdit} data-testid="sla-edit">Edit</Button>
              </>
            )}
          </Space>
        </div>
        <Space size={6} wrap>
          <ConditionPills policy={policy} catalogue={catalogue} />
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
  );
}

function ConditionPills({ policy, catalogue }: { policy: SlaPolicy; catalogue: SlaCatalogue | undefined }) {
  return conditionLabels(policy, catalogue).map((text) => (
    <span key={text} className="nx-td-pilltag nx-td-pilltag--acc nx-td-pilltag--plain">{text}</span>
  ));
}
