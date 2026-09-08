/**
 * `/admin/groups` — sets of people, and what being in one adds (§11).
 *
 * Five decisions worth stating, and the first is why the page is shaped this way.
 *
 * **The page has two privilege levels, because two of its fields do.** Editing
 * membership needs `users.manage`; editing what a group *grants* needs
 * `roles.manage`, since `_permissions_for` unions a group's permissions onto
 * its members' roles — so whoever edits them can grant any permission to
 * anybody, themselves included. The drawer therefore has two panels that can be
 * available independently, and the server answers both questions once
 * (`can_manage_members`, `can_manage_grants`) rather than being guessed at per
 * control.
 *
 * **A grant is offered from the permission catalogue the code checks for.** Not
 * a list kept here: a group granting `records.expport` grants nothing and looks
 * identical to one that works, and the only way to make that impossible is to
 * render the options from the same catalogue the endpoints read.
 *
 * **What a group grants is said in words on the row.** "3 permissions" tells
 * nobody whether being in this group lets somebody export the customer list.
 * The grants are named, and the count is the overflow.
 *
 * **Removing a group says what it costs before it happens.** How many people
 * are in it and which permissions they lose — because the whole hazard of this
 * screen is quietly reducing somebody's access.
 *
 * **A group with no grants is not a broken group.** Plenty exist only to
 * address a set of people, so an empty grants list is drawn as a fact rather
 * than as an empty state asking to be filled (§34).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined, TeamOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { groupsApi, type Group, type GroupDetail, type GroupKind } from "@/api/groups";
import { PageHeader } from "@/components/PageHeader";
import { PersonAvatar } from "@/components/PersonAvatar";
import { MemberPicker } from "@/components/PeoplePicker";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const { Text } = Typography;

/** How many grants a row names before it starts counting them. */
const NAMED_GRANTS = 3;

/**
 * What a group's grants come to, in words.
 *
 * Exported and asserted directly because "3 permissions" is the version that
 * tells nobody anything: the question this column answers is *whether being in
 * this group lets somebody export the customer list*, and only the names
 * answer it. The count is the overflow, not the headline.
 */
export function grantSummary(permissions: string[]): string {
  if (permissions.length === 0) return "Adds nothing";
  const named = permissions.slice(0, NAMED_GRANTS).join(", ");
  const rest = permissions.length - NAMED_GRANTS;
  return rest > 0 ? `${named} +${rest} more` : named;
}

/**
 * What removing a group will cost, said before it happens.
 *
 * The whole hazard of this screen is quietly reducing somebody's access, so
 * the confirmation names both halves — and says plainly when there is nothing
 * to lose, rather than leaving a blank where the warning would be.
 */
export function removalCost(group: Group): string {
  const people =
    group.member_count === 0
      ? "Nobody is in it"
      : `${group.member_count} ${group.member_count === 1 ? "person is" : "people are"} in it`;
  if (group.permissions.length === 0) {
    return `${people}, and it grants nothing — no access changes.`;
  }
  return `${people}, and they lose ${group.permissions.join(", ")}.`;
}

export default function GroupsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const [box, setBox] = useState(params.get("q") ?? "");
  const term = useDebouncedValue(box, 250);
  const kind = params.get("kind") ?? "";
  const opened = params.get("group");
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    set({ q: term || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const catalogue = useQuery({
    queryKey: ["groups", "catalogue"],
    queryFn: ({ signal }) => groupsApi.catalogue(signal),
    staleTime: 60_000,
  });

  const listing = useQuery({
    queryKey: ["groups", "list", term, kind],
    queryFn: ({ signal }) =>
      groupsApi.list(
        { ...(term ? { q: term } : {}), ...(kind ? { kind } : {}), page_size: 100 },
        signal,
      ),
  });

  const detail = useQuery({
    queryKey: ["groups", "entry", opened],
    queryFn: ({ signal }) => groupsApi.entry(opened!, signal),
    enabled: opened !== null,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["groups"] });
  };

  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : "That was refused.");

  const create = useMutation({
    mutationFn: (body: { name: string; kind?: GroupKind; description?: string }) =>
      groupsApi.create(body),
    onSuccess: async (group) => {
      message.success(`${group.name} exists, and grants nothing yet.`);
      setCreating(false);
      form.resetFields();
      await refresh();
      // Straight into the group, because the next thing anybody wants is to
      // put people in it.
      set({ group: group.id });
    },
    onError: failed,
  });

  const remove = useMutation({
    mutationFn: (id: string) => groupsApi.remove(id),
    onSuccess: async (result) => {
      message.success(
        result.permissions_withdrawn.length > 0 && result.members_affected > 0
          ? `${result.name} removed — ${result.members_affected} people lost ${result.permissions_withdrawn.join(", ")}.`
          : `${result.name} removed.`,
      );
      set({ group: null });
      await refresh();
    },
    onError: failed,
  });

  usePageCommands("admin-groups", [
    {
      id: "groups.new",
      label: "Make a group",
      keywords: "group create new team permissions",
      run: () => setCreating(true),
    },
  ]);

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (catalogue.isError) {
    return (
      <>
        <PageHeader title="Groups" />
        <Alert
          type="error"
          showIcon
          message={
            catalogue.error instanceof ApiError
              ? catalogue.error.message
              : "The groups could not be read."
          }
        />
      </>
    );
  }

  const { kinds, permissions, can_manage_members: canMembers, can_manage_grants: canGrants } =
    catalogue.data!;
  const rows = listing.data?.items ?? [];

  const columns: ColumnsType<Group> = [
    {
      title: "Group",
      dataIndex: "name",
      render: (name: string, row) => (
        <div className="nu-group-what">
          <Space size={6}>
            <Text strong>{name}</Text>
            <Tag bordered={false}>{row.kind.toLowerCase()}</Tag>
          </Space>
          <Text type="secondary" className="nu-group-slug">
            {row.description || row.slug}
          </Text>
        </div>
      ),
    },
    {
      title: "People",
      dataIndex: "member_count",
      width: 108,
      align: "right",
      render: (count: number) => (
        <Text type={count === 0 ? "secondary" : undefined}>
          {count === 0 ? "nobody" : `${count}`}
        </Text>
      ),
    },
    {
      title: "Adds",
      dataIndex: "permissions",
      width: 340,
      render: (values: string[]) => (
        // Named, not counted: "3 permissions" does not answer whether being in
        // this group lets somebody export the customer list.
        <Text type={values.length === 0 ? "secondary" : undefined} className="nu-group-grants">
          {grantSummary(values)}
        </Text>
      ),
    },
  ];

  return (
    <div className="nu-fill">
      <PageHeader
        title="Groups"
        subtitle="Sets of people. Being in one adds its permissions to whatever a person's role already allows."
        tag={<Tag>{catalogue.data!.total} groups</Tag>}
        actions={
          <Space size={8}>
            <Input.Search
              allowClear
              placeholder="Name or description"
              aria-label="Search groups"
              style={{ width: 230 }}
              value={box}
              onChange={(event) => setBox(event.target.value)}
            />
            <Select
              aria-label="Kind"
              value={kind || "all"}
              style={{ width: 165 }}
              onChange={(next) => set({ kind: next === "all" ? null : next })}
              options={[
                { value: "all", label: `Every kind (${catalogue.data!.total})` },
                ...kinds.map((item) => ({
                  value: item.key,
                  label: `${item.key.toLowerCase()} (${item.count})`,
                  disabled: item.count === 0,
                })),
              ]}
            />
            {canMembers && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setCreating(true)}
                data-testid="new-group"
              >
                New group
              </Button>
            )}
          </Space>
        }
      />

      {/* Said once at the top: a reader without either privilege is looking at
          a directory, and the reason will not change while they look (§76). */}
      {!canMembers && !canGrants && (
        <Alert
          className="nu-block"
          type="info"
          showIcon
          data-testid="read-only"
          message="You can see who is in which group, but not change anything."
          description="Changing membership needs `users.manage`; changing what a group grants needs `roles.manage`."
        />
      )}

      <div className="nu-pane nu-pane--table">
        <Table<Group>
          size="small"
          rowKey="id"
          data-testid="groups-table"
          columns={columns}
          dataSource={rows}
          loading={listing.isLoading}
          onRow={(row) => ({
            onClick: () => set({ group: row.id }),
            style: { cursor: "pointer" },
          })}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={term || kind ? "No group matches that." : "No groups yet."}
              />
            ),
          }}
          pagination={false}
        />
      </div>

      <Drawer
        open={opened !== null}
        onClose={() => set({ group: null })}
        width={640}
        title={detail.data?.name ?? "Group"}
        destroyOnClose
        extra={
          detail.data && canMembers ? (
            <Popconfirm
              title={`Remove ${detail.data.name}?`}
              description={removalCost(detail.data)}
              okText="Remove it"
              okButtonProps={{ danger: true }}
              onConfirm={() => remove.mutate(detail.data.id)}
            >
              <Button danger icon={<DeleteOutlined />} loading={remove.isPending} data-testid="remove-group">
                Remove
              </Button>
            </Popconfirm>
          ) : undefined
        }
      >
        {detail.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}
        {detail.isError && (
          <Alert
            type="error"
            showIcon
            message={
              detail.error instanceof ApiError
                ? detail.error.message
                : "That group could not be read."
            }
          />
        )}
        {detail.data && (
          <GroupPanels
            group={detail.data}
            permissions={permissions}
            canMembers={canMembers}
            canGrants={canGrants}
            onSaved={refresh}
            onError={failed}
          />
        )}
      </Drawer>

      <Modal
        open={creating}
        onCancel={() => setCreating(false)}
        title="New group"
        okText="Make it"
        confirmLoading={create.isPending}
        onOk={() => {
          void form
            .validateFields()
            .then((values: { name: string; kind?: GroupKind; description?: string }) =>
              create.mutate(values),
            )
            .catch(() => {
              // `validateFields` rejects on an empty field and the form is
              // already showing why; swallowing it here is what stops an
              // unhandled rejection in the test run.
            });
        }}
        okButtonProps={{ "data-testid": "create-group" }}
      >
        <Form form={form} layout="vertical" data-testid="group-form" initialValues={{ kind: "TEAM" }}>
          {/* Said on the way in, because a group that arrived granting
              something would grant it at the moment it was made. */}
          <Alert
            type="info"
            showIcon
            className="nu-block"
            message="It starts granting nothing"
            description="What a group grants is set separately, and needs `roles.manage`."
          />
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: "A group needs a name." }]}
          >
            <Input autoFocus maxLength={80} placeholder="Release managers" aria-label="Group name" />
          </Form.Item>
          <Form.Item name="kind" label="Kind">
            <Select
              aria-label="Group kind"
              options={kinds.map((item) => ({
                value: item.key,
                label: item.key.toLowerCase(),
              }))}
            />
          </Form.Item>
          <Form.Item name="description" label="What it is for">
            <Input.TextArea
              rows={2}
              maxLength={240}
              placeholder="Who to page when a release goes wrong."
              aria-label="Group description"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/**
 * The two panels, each available on its own privilege.
 *
 * Kept as one component because they describe one group, and split into two
 * *saves* because they are two privileges: an editor that saved both at once
 * would need both, and a manager would be unable to use the half they hold.
 */
function GroupPanels({
  group,
  permissions,
  canMembers,
  canGrants,
  onSaved,
  onError,
}: {
  group: GroupDetail;
  permissions: Array<{ code: string; label: string }>;
  canMembers: boolean;
  canGrants: boolean;
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const { message } = AntApp.useApp();
  const [members, setMembers] = useState<string[]>(group.members.map((person) => person.id));
  const [grants, setGrants] = useState<string[]>(group.permissions);

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

  const membersMoved =
    [...members].sort().join() !== [...group.members.map((p) => p.id)].sort().join();
  const grantsMoved = [...grants].sort().join() !== [...group.permissions].sort().join();

  return (
    <Space direction="vertical" size={20} className="nu-block">
      <div>
        <Space size={8}>
          <Tag bordered={false}>{group.kind.toLowerCase()}</Tag>
          <Text type="secondary" className="nu-mono">
            {group.slug}
          </Text>
        </Space>
        {group.description && <p className="nu-group-about">{group.description}</p>}
      </div>

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
                <PersonAvatar
                  size={22}
                  name={person.full_name}
                  initials={person.initials}
                  src={person.avatar_url}
                />
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
            <MemberPicker
              aria-label="Members"
              value={members}
              onChange={setMembers}
              placeholder="Add somebody"
            />
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
              options={permissions.map((item) => ({
                value: item.code,
                label: `${item.code} — ${item.label}`,
              }))}
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
              Changing what a group grants needs <code>roles.manage</code>, because it is
              granting permissions.
            </Text>
          </>
        )}
      </section>
    </Space>
  );
}
