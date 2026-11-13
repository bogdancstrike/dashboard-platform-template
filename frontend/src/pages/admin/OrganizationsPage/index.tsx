/**
 * `/admin/organizations` — the shape of the company (§42).
 *
 * Five decisions worth stating.
 *
 * **Two panes, not two pages.** The tenants on the left, the chosen one's
 * structure on the right. They are one question — *where does a person sit* —
 * and splitting them across routes would mean losing the tree every time
 * somebody compared two organisations.
 *
 * **The tree is a tree, drawn with indentation and a rail.** Not a table with a
 * `parent` column: the whole point of this screen is that structure is visible
 * at a glance, and a flat list with an id in it is a structure somebody has to
 * reconstruct in their head.
 *
 * **Two numbers per department, and they are labelled.** Its own people, and
 * its subtree's. One number would either understate a parent or make the tree
 * sum to more than the company employs — and the reader cannot tell which
 * without being told.
 *
 * **The unplaced are counted where they can be seen.** People in no
 * department, and teams in no department, are the reason a tree sums to less
 * than the tenant's total — so they are on the screen rather than left as a
 * discrepancy somebody spends an afternoon on (§34).
 *
 * **A refusal explains the structure.** "Move them first" with the count of
 * what is in the way, and for a bad move, the path that would close the loop —
 * because "invalid parent" on a four-level tree is a message that starts an
 * investigation instead of ending one (§76).
 */

import { Alert, Button, Skeleton, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";
import { apiMessage } from "@/lib/errors";

import { NewDepartmentModal } from "./NewDepartmentModal";
import { OrgList } from "./OrgList";
import { Structure } from "./Structure";
import { useOrganizationsPage } from "./useOrganizationsPage";

export { movableInto, peopleLabel } from "./orgTree";

const READ_ONLY = (
  <Alert
    className="nu-block"
    type="info"
    showIcon
    data-testid="read-only"
    message="You can read the structure but not change it."
    description="Redrawing the company needs `orgs.manage`."
  />
);

export default function OrganizationsPage() {
  const page = useOrganizationsPage();
  const { catalogue, listing, opened, tree, moveDepartment, removeDepartment } = page;

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (catalogue.isError) {
    return (
      <>
        <PageHeader title="Organizations" />
        <Alert type="error" showIcon message={apiMessage(catalogue.error, "The organizations could not be read.")} />
      </>
    );
  }

  const canManage = catalogue.data!.can_manage;

  return (
    <div className="nu-fill nx-ad nx-ad--orgs">
      <PageHeader
        title="Organizations"
        subtitle="The tenants, their departments and the teams inside them."
        tag={<Tag>{catalogue.data!.total} tenants</Tag>}
        actions={
          canManage && opened ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => page.setAdding({ parentId: null })}
              data-testid="new-department"
            >
              Add department
            </Button>
          ) : undefined
        }
      />

      {!canManage && READ_ONLY}

      <div className="nu-orgsplit">
        <OrgList
          organizations={listing.data?.items ?? []}
          loading={listing.isLoading}
          opened={opened}
          onChoose={page.choose}
        />

        <div className="nu-orgstructure">
          {tree.isLoading && <Skeleton active paragraph={{ rows: 10 }} />}
          {tree.isError && <Alert type="error" showIcon message={apiMessage(tree.error, "That structure could not be read.")} />}
          {tree.data && (
            <Structure
              tree={tree.data}
              catalogue={catalogue.data!}
              canManage={canManage}
              onAdd={(parentId) => page.setAdding({ parentId })}
              onMove={(id, parentId) => moveDepartment.mutate({ id, parentId })}
              onRemove={(id) => removeDepartment.mutate(id)}
              busy={moveDepartment.isPending || removeDepartment.isPending}
            />
          )}
        </div>
      </div>

      <NewDepartmentModal
        adding={page.adding}
        organizationId={opened}
        onClose={() => page.setAdding(null)}
        onAdded={page.refresh}
        onError={page.failed}
      />
    </div>
  );
}
