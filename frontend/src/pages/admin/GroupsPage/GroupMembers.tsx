import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App as AntApp, Button, Typography } from "antd";
import { TeamOutlined } from "@ant-design/icons";

import { groupsApi, type GroupDetail } from "@/api/groups";
import { MemberPicker } from "@/components/PeoplePicker";
import { PersonAvatar } from "@/components/PersonAvatar";

const { Text } = Typography;

interface GroupMembersProps {
  group: GroupDetail;
  canMembers: boolean;
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}

/** Who is in the group; editable with `users.manage`. */
export function GroupMembers({ group, canMembers, onSaved, onError }: GroupMembersProps) {
  const { message } = AntApp.useApp();
  const [members, setMembers] = useState<string[]>(group.members.map((person) => person.id));

  const saveMembers = useMutation({
    mutationFn: (ids: string[]) => groupsApi.setMembers(group.id, ids),
    onSuccess: async (result) => {
      message.success(
        `${group.name}: ${result.added} added, ${result.removed} removed. In force on their next request.`,
      );
      await onSaved();
    },
    onError,
  });

  const membersMoved =
    [...members].sort().join() !== [...group.members.map((p) => p.id)].sort().join();

  return (
    <section data-testid="group-members">
      <Text strong>
        <TeamOutlined /> Who is in it{" "}
        <Text type="secondary">
          ({group.member_count}
          {group.member_overflow > 0 ? `, showing ${group.members.length}` : ""})
        </Text>
      </Text>

      {group.members.length === 0 ? (
        <p>
          <Text type="secondary">Nobody yet.</Text>
        </p>
      ) : (
        <ul className="nu-group-people">
          {group.members.map((person) => (
            <li key={person.id}>
              <PersonAvatar size={22} name={person.full_name} initials={person.initials} src={person.avatar_url} />
              <span className="nu-group-person">
                <Text>{person.full_name}</Text>
                <Text type="secondary">
                  {person.job_title || person.email}
                  {person.role_code ? ` · ${person.role_code.toLowerCase()}` : ""}
                </Text>
              </span>
            </li>
          ))}
        </ul>
      )}

      {canMembers ? (
        <div className="nu-group-edit">
          <MemberPicker aria-label="Members" value={members} onChange={setMembers} placeholder="Add somebody" />
          <Button
            type="primary"
            disabled={!membersMoved}
            loading={saveMembers.isPending}
            onClick={() => saveMembers.mutate(members)}
            data-testid="save-members"
          >
            Save membership
          </Button>
        </div>
      ) : (
        <Text type="secondary" className="nu-group-locked">
          Changing membership needs <code>users.manage</code>.
        </Text>
      )}
    </section>
  );
}
