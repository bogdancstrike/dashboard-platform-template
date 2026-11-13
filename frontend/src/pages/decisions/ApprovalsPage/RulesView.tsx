import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Popconfirm, Skeleton, Switch, Typography } from "antd";

import { approvalsApi, type ChangeRule } from "@/api/approvals";
import { useAuth } from "@/auth/AuthProvider";
import { TdIcon } from "@/components/icons/TdIcon";
import { NxIcon } from "@/components/NxIcon";
import { errorText, errorToast } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

import { RuleModal } from "./RuleModal";
import { describeRule } from "./describeRule";

const { Text } = Typography;

/** The change rules: which edits are held back for a decision. */
export function RulesView() {
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
  const describe = (rule: ChangeRule) => describeRule(rule, data);
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
