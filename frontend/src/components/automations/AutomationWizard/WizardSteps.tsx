import { Alert, Space, Typography } from "antd";

import type { AutomationRule, AutomationRun } from "@/api/automations";
import type { ExplorerResource } from "@/api/explorer";
import { AdvancedQueryBuilder } from "@/components/explorer/AdvancedQueryBuilder";
import type { QueryNode } from "@/components/explorer/queryTree";

import { RunReport } from "../RunReport";

const { Text } = Typography;

/** Step two: the condition, in the advanced search's own editor. */
export function ConditionStep({ resource, condition, setCondition }: {
  resource: ExplorerResource | undefined;
  condition: QueryNode | null;
  setCondition: (tree: QueryNode) => void;
}) {
  return resource ? (
    <div data-testid="wizard-condition">
      <AdvancedQueryBuilder fields={resource.fields} value={condition} onChange={setCondition} />
      <Text type="secondary">
        The same editor the advanced search uses, and the same compiler — so a
        condition that finds the right rows here finds them there too.
      </Text>
    </div>
  ) : (
    <Alert type="warning" showIcon message="That dataset has no fields to search." />
  );
}

/** Step four: it exists, paused, and this is what it would have done. */
export function RehearsalStep({ created, rehearsal }: { created: AutomationRule | null; rehearsal: AutomationRun | null }) {
  return (
    <Space direction="vertical" size={12} className="nu-block" data-testid="wizard-rehearsal">
      <Alert
        type="success"
        showIcon
        message={`${created?.name} was created, paused`}
        description="Nothing has been sent. Below is what it would have done to the records that exist right now — switch it on from the drawer when it looks right."
      />
      {rehearsal ? (
        <RunReport run={rehearsal} dense />
      ) : (
        <Text type="secondary">The rehearsal could not be run. Try it from the drawer.</Text>
      )}
    </Space>
  );
}
