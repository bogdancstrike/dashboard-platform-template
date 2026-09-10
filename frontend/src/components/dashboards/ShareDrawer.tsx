/**
 * Who can see this dashboard, and how they get to it (§45).
 *
 * Split out of the settings drawer, which is where it used to live as one
 * segmented control among six fields. Sharing is not a setting — it is a
 * decision with consequences somebody wants stated before they make it, and
 * burying it under "Name" and "What it is for" is how a dashboard ends up
 * public because a control happened to be next to the save button.
 *
 * Three things this says that a `scope` field cannot.
 *
 * **What each choice actually means, in the sentence under it.** "Named
 * people" and "Everyone" are not self-explanatory in a product with roles: the
 * useful fact is that a reader still only sees the widgets their own
 * permissions answer, so sharing a dashboard is never sharing the data on it.
 * That is true, load-bearing, and nowhere else on the screen.
 *
 * **Who has it right now.** A list of names, with the owner marked — because
 * "shared with 4" is a number somebody has to open a drawer to understand,
 * and the question being asked is usually about one specific person.
 *
 * **The link.** A shared dashboard that cannot be pasted into a message is a
 * dashboard nobody visits. The address is the same one the page reads, so what
 * gets pasted opens exactly what the sharer is looking at (§69).
 */

import { App as AntApp, Alert, Avatar, Button, Drawer, Input, List, Segmented, Space, Tag, Typography } from "antd";
import { CopyOutlined, GlobalOutlined, LockOutlined, TeamOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";

import type { DashboardScope, SavedDashboard } from "@/api/dashboards";
import { MemberPicker } from "@/components/PeoplePicker";
import { PersonAvatar } from "@/components/PersonAvatar";

const { Text, Paragraph } = Typography;

/** What each scope means, said in the words somebody is choosing between. */
const SCOPES: Record<DashboardScope, { label: string; icon: JSX.Element; means: string }> = {
  PRIVATE: {
    label: "Only me",
    icon: <LockOutlined />,
    means: "Nobody else can open it, and it appears in nobody else's gallery.",
  },
  SHARED: {
    label: "Named people",
    icon: <TeamOutlined />,
    means:
      "The people you name can open it and copy it. Only you can change the layout — a copy is theirs to change.",
  },
  PUBLIC: {
    label: "Everyone",
    icon: <GlobalOutlined />,
    means:
      "Anyone signed in finds it in their gallery. Still only you can change it.",
  },
};

export function ShareDrawer({
  open,
  dashboard,
  saving,
  canShare,
  onClose,
  onSave,
}: {
  open: boolean;
  dashboard: SavedDashboard | undefined;
  saving: boolean;
  canShare: boolean;
  onClose: () => void;
  onSave: (input: { scope: DashboardScope; member_ids: string[] }) => void;
}) {
  const { message } = AntApp.useApp();
  const [scope, setScope] = useState<DashboardScope>(dashboard?.scope ?? "PRIVATE");
  const [members, setMembers] = useState<string[]>([]);

  // Seeded whenever the drawer opens on a dashboard, rather than held in sync:
  // a draft left over from a drawer somebody cancelled is the classic way a
  // share applies the wrong audience.
  useEffect(() => {
    if (!open || !dashboard) return;
    setScope(dashboard.scope);
    setMembers(dashboard.members.map((member) => member.id));
  }, [open, dashboard]);

  if (!dashboard) return null;

  const link = `${window.location.origin}/dashboards?dashboard=${dashboard.id}`;
  const changed =
    scope !== dashboard.scope ||
    members.join(",") !== dashboard.members.map((member) => member.id).join(",");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      message.success("Link copied");
    } catch {
      // A clipboard a browser refuses is not an error worth an alert: the
      // address is in a field beside the button, selectable and readable.
      message.info("Copy the address from the field — this browser blocked the clipboard.");
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={430}
      title={`Share — ${dashboard.name}`}
      data-testid="share-drawer"
      extra={
        <Button
          type="primary"
          loading={saving}
          disabled={!changed}
          onClick={() => onSave({ scope, member_ids: scope === "SHARED" ? members : [] })}
          data-testid="save-share"
        >
          Save
        </Button>
      }
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div>
          <Text strong>Who can see it</Text>
          <Segmented
            block
            className="nu-share-scope"
            value={scope}
            onChange={(value) => setScope(value)}
            options={(Object.keys(SCOPES) as DashboardScope[]).map((key) => ({
              value: key,
              label: SCOPES[key].label,
              icon: SCOPES[key].icon,
              disabled: key !== "PRIVATE" && !canShare,
            }))}
          />
          <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            {SCOPES[scope].means}
          </Paragraph>
        </div>

        {!canShare && (
          <Alert
            type="info"
            showIcon
            message="Sharing needs the searches.share permission"
            description="Your role can build dashboards and keep them. Naming an audience is the part it does not include."
          />
        )}

        {scope === "SHARED" && (
          <div>
            <Text strong>Shared with</Text>
            <MemberPicker
              value={members}
              onChange={setMembers}
              placeholder="Search colleagues"
            />
          </div>
        )}

        {/* Who has it *now* — the saved answer, not the draft above, so the
            two are distinguishable while an edit is in flight. */}
        {(dashboard.scope !== "PRIVATE" || dashboard.members.length > 0) && (
          <List
            size="small"
            header={<Text type="secondary">Access today</Text>}
            dataSource={[
              {
                id: dashboard.owner.id,
                name: dashboard.owner.name,
                email: dashboard.owner.email ?? "",
                owner: true,
              },
              ...dashboard.members.map((member) => ({ ...member, owner: false })),
            ]}
            renderItem={(person) => (
              <List.Item>
                <Space size={8}>
                  <PersonAvatar name={person.name} size={24} />
                  <span>
                    <Text>{person.name}</Text>
                    {person.email && (
                      <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                        {person.email}
                      </Text>
                    )}
                  </span>
                </Space>
                <Tag bordered={false} color={person.owner ? "blue" : undefined}>
                  {person.owner ? "owner · can edit" : "can view and copy"}
                </Tag>
              </List.Item>
            )}
            footer={
              dashboard.scope === "PUBLIC" ? (
                <Space size={6}>
                  <Avatar size={24} icon={<GlobalOutlined />} />
                  <Text type="secondary">and everyone else signed in</Text>
                </Space>
              ) : null
            }
          />
        )}

        <div>
          <Text strong>Link to it</Text>
          <Space.Compact style={{ width: "100%", marginTop: 6 }}>
            <Input readOnly value={link} aria-label="Link to this dashboard" />
            <Button icon={<CopyOutlined />} onClick={() => void copy()} data-testid="copy-link">
              Copy
            </Button>
          </Space.Compact>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Opening it needs an account and the access above. A widget still only shows what the
            reader&apos;s own role can answer — sharing a layout is not sharing data.
          </Text>
        </div>
      </Space>
    </Drawer>
  );
}
