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

import { Alert, Button, Select, Skeleton, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ListBar, ListPanel } from "@/components/listing/ListBar";
import { ResponsiveTable } from "@/components/listing/ResponsiveTable";
import type { Group } from "@/api/groups";
import { apiMessage } from "@/lib/errors";

import { GroupDrawer } from "./GroupDrawer";
import { NewGroupModal } from "./NewGroupModal";
import { groupCard, groupColumns } from "./groupColumns";
import { useGroupsPage } from "./useGroupsPage";

export { grantSummary, removalCost } from "./groupCopy";

/* Said once at the top: a reader without either privilege is looking at a
   directory, and the reason will not change while they look (§76). */
const READ_ONLY = (
  <Alert
    className="nu-block"
    type="info"
    showIcon
    data-testid="read-only"
    message="You can see who is in which group, but not change anything."
    description="Changing membership needs `users.manage`; changing what a group grants needs `roles.manage`."
  />
);

export default function GroupsPage() {
  const page = useGroupsPage();
  const { search, kind, overlay, catalogue, listing, detail } = page;

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (catalogue.isError) {
    return (
      <>
        <PageHeader title="Groups" />
        <Alert type="error" showIcon message={apiMessage(catalogue.error, "The groups could not be read.")} />
      </>
    );
  }

  const { kinds, permissions, total, can_manage_members: canMembers, can_manage_grants: canGrants } =
    catalogue.data!;

  return (
    <div className="nu-fill nx-ad nx-ad--groups">
      <PageHeader
        title="Groups"
        subtitle={`${total} groups — sets of people. Being in one adds its permissions to whatever a person's role already allows.`}
        tag={<Tag>{total} groups</Tag>}
        actions={
          canMembers ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => page.setCreating(true)} data-testid="new-group">
              New group
            </Button>
          ) : undefined
        }
      />

      <GroupFilters search={search} kind={kind} total={total} kinds={kinds} />

      {!canMembers && !canGrants && READ_ONLY}

      <ListPanel>
        <ResponsiveTable<Group>
          card={groupCard}
          size="small"
          rowKey="id"
          data-testid="groups-table"
          columns={groupColumns}
          dataSource={listing.data?.items ?? []}
          loading={listing.isLoading}
          onRow={(row) => ({ onClick: () => overlay.open(row.id), style: { cursor: "pointer" } })}
          locale={{
            emptyText: <EmptyState compact title={search.term || kind ? "No group matches that." : "No groups yet."} />,
          }}
          pagination={false}
        />
      </ListPanel>

      <GroupDrawer
        open={overlay.value !== null}
        onClose={overlay.close}
        detail={detail}
        onRemove={(id) => page.remove.mutate(id)}
        removing={page.remove.isPending}
        permissions={permissions}
        canMembers={canMembers}
        canGrants={canGrants}
        onSaved={page.refresh}
        onError={page.failed}
      />

      <NewGroupModal
        open={page.creating}
        kinds={kinds}
        onClose={() => page.setCreating(false)}
        onCreated={async (group) => {
          await page.refresh();
          overlay.open(group.id);
        }}
        onError={page.failed}
      />
    </div>
  );
}

/** The search box and the kind filter, both in the address. */
function GroupFilters({ search, kind, total, kinds }: {
  search: ReturnType<typeof useGroupsPage>["search"];
  kind: string;
  total: number;
  kinds: Array<{ key: string; count: number }>;
}) {
  return (
    <ListBar
      search={{
        placeholder: "Search groups by name or description",
        "aria-label": "Search groups",
        value: search.box,
        onChange: (event) => search.setBox(event.target.value),
      }}
    >
      <Select
        aria-label="Kind"
        value={kind || "all"}
        className={kind ? "nx-ad-set" : undefined}
        popupMatchSelectWidth={false}
        style={{ minWidth: 170 }}
        onChange={(next) => search.set({ kind: next === "all" ? null : next })}
        options={[
          { value: "all", label: `Kind: any (${total})` },
          ...kinds.map((item) => ({
            value: item.key,
            label: `${item.key.toLowerCase()} (${item.count})`,
            disabled: item.count === 0,
          })),
        ]}
      />
    </ListBar>
  );
}
