/**
 * What a rule does when it fires (§49, §76).
 *
 * The editor is rendered from the *server's* action catalogue rather than from
 * a list of kinds typed in here. That is not ceremony: the same declaration
 * says which fields an action needs and which function executes it, so a
 * control this form offers is a control something reads, and an action the
 * engine gained yesterday appears here today. A hand-written form is how you
 * end up asking for a field nothing uses, or — worse — not asking for one the
 * executor requires and finding out when the rule fires at three in the
 * morning.
 *
 * Shared between the create wizard and the edit drawer, because "what it does"
 * is the same question in both and two copies would answer it differently.
 */


import { Alert, Button, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import type { AutomationAction, AutomationCatalogue } from "@/api/automations";

import { ActionCard } from "./ActionCard";
import { blankAction } from "./actionRules";

export { actionProblem, blankAction } from "./actionRules";

export function ActionListEditor({
  value,
  onChange,
  catalogue,
  disabled,
}: {
  value: AutomationAction[];
  onChange: (next: AutomationAction[]) => void;
  catalogue: AutomationCatalogue;
  disabled?: boolean;
}) {
  const replace = (index: number, changes: Partial<AutomationAction>) =>
    onChange(value.map((item, at) => (at === index ? { ...item, ...changes } : item)));

  return (
    <Space direction="vertical" size={12} className="nu-block" data-testid="action-list">
      {value.length === 0 && (
        // Not a neutral empty state: a rule with no actions matches, records
        // fires and does nothing, which is the failure that looks like success.
        <Alert
          type="warning"
          showIcon
          message="This automation would do nothing"
          description="It needs at least one action before it can be saved."
        />
      )}

      {value.map((action, index) => (
        <ActionCard
          key={`${action.kind}-${index}`}
          action={action}
          index={index}
          catalogue={catalogue}
          disabled={disabled}
          replace={replace}
          onKind={(kind) => onChange(value.map((item, at) => (at === index ? blankAction(kind) : item)))}
          onRemove={() => onChange(value.filter((_item, at) => at !== index))}
        />
      ))}

      <Space size={8} wrap>
        {catalogue.actions.map((item) => (
          <Button
            key={item.kind}
            size="small"
            icon={<PlusOutlined />}
            disabled={disabled || value.length >= 8}
            data-testid={`add-action-${item.kind}`}
            onClick={() => onChange([...value, blankAction(item.kind)])}
          >
            {item.label}
          </Button>
        ))}
      </Space>
    </Space>
  );
}
