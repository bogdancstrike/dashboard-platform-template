import { useQuery } from "@tanstack/react-query";
import { Alert, Form, Select, Slider, Typography } from "antd";

import { groupsApi } from "@/api/groups";
import { organizationsApi } from "@/api/organizations";
import type { FeatureFlag } from "@/api/settings";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { reachOf } from "./flagReach";

const { Text } = Typography;

export interface Targeting {
  rollout_percentage: number;
  target_roles: string[];
  target_group_ids: string[];
  target_organization_ids: string[];
}

export interface TargetingFormProps {
  flag: FeatureFlag;
  draft: Targeting;
  setDraft: (next: Targeting) => void;
  roles: { value: string; label: string }[];
  open: boolean;
}

/** The rollout share and the roles, groups and organizations that always have the flag. */
export function TargetingForm({ flag, draft, setDraft, roles, open }: TargetingFormProps) {
  const groups = useQuery({
    queryKey: queryKeys.flagGroups(),
    queryFn: ({ signal }) => groupsApi.list({ page_size: 200 }, signal),
    enabled: open,
    staleTime: STALE.minute,
  });
  const organizations = useQuery({
    queryKey: queryKeys.flagOrganizations(),
    queryFn: ({ signal }) => organizationsApi.list({}, signal),
    enabled: open,
    staleTime: STALE.minute,
  });
  return (
    <Form layout="vertical" data-testid="flag-targeting">
      <Alert
        className="nu-block"
        type={flag.enabled ? "info" : "warning"}
        showIcon
        message={flag.enabled ? reachOf({ ...flag, ...draft }) : "The switch is off — targeting applies once it is on."}
      />
      <Form.Item label={`Everybody else: ${draft.rollout_percentage}% of people`}>
        <Slider
          min={0}
          max={100}
          step={5}
          value={draft.rollout_percentage}
          ariaLabelForHandle="Rollout percentage"
          onChange={(value: number) => setDraft({ ...draft, rollout_percentage: value })}
        />
      </Form.Item>
      <Form.Item label="Roles that always have it">
        <Select
          mode="multiple"
          allowClear
          aria-label="Target roles"
          value={draft.target_roles}
          options={roles}
          onChange={(value: string[]) => setDraft({ ...draft, target_roles: value })}
        />
      </Form.Item>
      <Form.Item label="Groups that always have it">
        <Select
          mode="multiple"
          allowClear
          showSearch
          optionFilterProp="label"
          aria-label="Target groups"
          loading={groups.isLoading}
          value={draft.target_group_ids}
          options={(groups.data?.items ?? []).map((group) => ({ value: group.id, label: group.name }))}
          onChange={(value: string[]) => setDraft({ ...draft, target_group_ids: value })}
        />
      </Form.Item>
      <Form.Item label="Organizations that always have it">
        <Select
          mode="multiple"
          allowClear
          showSearch
          optionFilterProp="label"
          aria-label="Target organizations"
          loading={organizations.isLoading}
          value={draft.target_organization_ids}
          options={(organizations.data?.items ?? []).map((org) => ({ value: org.id, label: org.name }))}
          onChange={(value: string[]) => setDraft({ ...draft, target_organization_ids: value })}
        />
      </Form.Item>
      {flag.target_user_ids.length > 0 && (
        <Text type="secondary">
          Also on for {flag.target_user_ids.length} named {flag.target_user_ids.length === 1 ? "person" : "people"}.
        </Text>
      )}
    </Form>
  );
}
