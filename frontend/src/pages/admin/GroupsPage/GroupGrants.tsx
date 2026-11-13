import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App as AntApp, Button, Select, Space, Tag, Tooltip, Typography } from "antd";

import { groupsApi, type GroupDetail } from "@/api/groups";

const { Text } = Typography;

interface GroupGrantsProps {
  group: GroupDetail;
  permissions: Array<{ code: string; label: string }>;
  canGrants: boolean;
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}

/** What being in the group adds; editable with `roles.manage`. */
export function GroupGrants({ group, permissions, canGrants, onSaved, onError }: GroupGrantsProps) {
  const { message } = AntApp.useApp();
  const [grants, setGrants] = useState<string[]>(group.permissions);

  const saveGrants = useMutation({
    mutationFn: (codes: string[]) => groupsApi.setGrants(group.id, codes),
    onSuccess: async (result) => {
      message.success(
        result.added.length === 0 && result.removed.length === 0
          ? "Nothing changed."
          : `${group.name} now grants ${result.permissions.length === 0 ? "nothing" : result.permissions.join(", ")}.`,
      );
      await onSaved();
    },
    onError,
  });

  const grantsMoved = [...grants].sort().join() !== [...group.permissions].sort().join();

  return (
    <section data-testid="group-grants">
      <Text strong>What being in it adds</Text>
      <p>
        <Text type="secondary">
          On top of whatever the person&apos;s role already allows, on their next request.
        </Text>
      </p>

      {group.permissions.length === 0 && !canGrants && (
        // A fact, not an empty state asking to be filled: plenty of groups
        // exist only to address a set of people (§34).
        <Text type="secondary">This group adds nothing — it is only a way to name these people.</Text>
      )}

      {canGrants ? (
        <div className="nu-group-edit">
          <Select
            mode="multiple"
            aria-label="Permissions"
            placeholder="Nothing — it only names a set of people"
            value={grants}
            onChange={setGrants}
            style={{ width: "100%" }}
            optionFilterProp="label"
            // From the catalogue the *code* checks for, so this cannot offer
            // a permission no endpoint requires.
            options={permissions.map((item) => ({ value: item.code, label: `${item.code} — ${item.label}` }))}
          />
          <Tooltip title="Granting permissions, which is why it needs `roles.manage`">
            <Button
              type="primary"
              disabled={!grantsMoved}
              loading={saveGrants.isPending}
              onClick={() => saveGrants.mutate(grants)}
              data-testid="save-grants"
            >
              Save grants
            </Button>
          </Tooltip>
        </div>
      ) : (
        <>
          <Space size={[4, 4]} wrap className="nu-block">
            {group.permissions.map((code) => (
              <Tag key={code} bordered={false}>
                {code}
              </Tag>
            ))}
          </Space>
          <Text type="secondary" className="nu-group-locked" data-testid="grants-locked">
            Changing what a group grants needs <code>roles.manage</code>, because it is granting permissions.
          </Text>
        </>
      )}
    </section>
  );
}
