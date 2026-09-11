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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ApartmentOutlined,
  DeleteOutlined,
  PlusOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  organizationsApi,
  type DepartmentNode,
  type OrgCatalogue,
  type OrgTree,
} from "@/api/organizations";
import { PageHeader } from "@/components/PageHeader";
import { PersonAvatar } from "@/components/PersonAvatar";
import { usePageCommands } from "@/commands/CommandContext";
import { formatNumber } from "@/lib/formats";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

/**
 * Every department in a tree, flattened with its depth.
 *
 * Exported because it is what the "move into" picker offers, and the rule it
 * encodes is not obvious: a department cannot move into *itself or anything
 * below it*, so the excluded subtree has to be pruned before the options are
 * built. Offering the whole list and letting the server refuse would be a
 * control that produces an error on purpose.
 */
export function movableInto(
  nodes: DepartmentNode[],
  excluding: string,
  maxDepth: number,
): Array<{ id: string; label: string; depth: number }> {
  const out: Array<{ id: string; label: string; depth: number }> = [];
  const walk = (list: DepartmentNode[]) => {
    for (const node of list) {
      if (node.id === excluding) continue;
      // A parent at the last level has nowhere to put a child.
      if (node.depth < maxDepth - 1) {
        out.push({ id: node.id, label: node.name, depth: node.depth });
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * How a department's two people-counts read.
 *
 * One number here would be a lie in one direction or the other: its own
 * understates a parent, its subtree's makes the tree sum to more than the
 * company employs. So a parent says both.
 *
 * The wording is "in all" and not "below", which the first version said —
 * `people_in_subtree` *includes* the department itself, so "2 here, 7 below"
 * reads as nine people when there are seven. And there is no special case for
 * the two being equal: a parent whose children are all empty would then read
 * "5 below" when all five are in fact *here*. A uniform shape for every parent
 * is also the easier one to scan down a tree of forty rows.
 */
export function peopleLabel(node: DepartmentNode): string {
  if (node.children.length === 0) {
    return node.people === 1 ? "1 person" : `${node.people} people`;
  }
  return `${node.people} here, ${node.people_in_subtree} in all`;
}

export default function OrganizationsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);
  const [form] = Form.useForm();
  const { touch, settled, requestClose } = useDiscardGuard({
    close: () => setAdding(null),
    what: "department",
  });

  const chosen = params.get("org");

  const catalogue = useQuery({
    queryKey: ["orgs", "catalogue"],
    queryFn: ({ signal }) => organizationsApi.catalogue(signal),
    staleTime: 60_000,
  });

  const listing = useQuery({
    queryKey: ["orgs", "list"],
    queryFn: ({ signal }) => organizationsApi.list({ page_size: 100 }, signal),
  });

  // The reader's own tenant when nothing is chosen: a page that opened on
  // whichever organisation sorted first would open on somebody else's.
  const opened =
    chosen ??
    catalogue.data?.own_organization_id ??
    listing.data?.items[0]?.id ??
    null;

  const tree = useQuery({
    queryKey: ["orgs", "tree", opened],
    queryFn: ({ signal }) => organizationsApi.tree(opened!, signal),
    enabled: opened !== null,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["orgs"] });
  };

  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : "That was refused.");

  const addDepartment = useMutation({
    mutationFn: (body: { name: string; code: string; parent_id?: string | null }) =>
      organizationsApi.addDepartment(opened!, body),
    onSuccess: async (created) => {
      settled();
      message.success(`${created.name} added.`);
      setAdding(null);
      form.resetFields();
      await refresh();
    },
    onError: failed,
  });

  const moveDepartment = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      organizationsApi.editDepartment(id, { parent_id: parentId }),
    onSuccess: async () => {
      message.success("Moved.");
      await refresh();
    },
    // The server's sentence, which names the path that would close the loop.
    onError: failed,
  });

  const removeDepartment = useMutation({
    mutationFn: (id: string) => organizationsApi.removeDepartment(id),
    onSuccess: async (result) => {
      message.success(`${result.name} retired.`);
      await refresh();
    },
    onError: failed,
  });

  usePageCommands("admin-orgs", [
    {
      id: "orgs.department",
      label: "Add a department",
      keywords: "department org structure team",
      run: () => setAdding({ parentId: null }),
    },
    {
      id: "orgs.people",
      label: "See the people instead",
      keywords: "users people accounts staff directory",
      run: () => navigate("/admin/users"),
    },
    {
      id: "orgs.groups",
      label: "See the groups instead",
      keywords: "groups teams membership sharing",
      run: () => navigate("/admin/groups"),
    },
  ]);

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (catalogue.isError) {
    return (
      <>
        <PageHeader title="Organizations" />
        <Alert
          type="error"
          showIcon
          message={
            catalogue.error instanceof ApiError
              ? catalogue.error.message
              : "The organizations could not be read."
          }
        />
      </>
    );
  }

  const canManage = catalogue.data!.can_manage;
  const organizations = listing.data?.items ?? [];

  return (
    <div className="nu-fill">
      <PageHeader
        title="Organizations"
        subtitle="The tenants, their departments and the teams inside them."
        tag={<Tag>{catalogue.data!.total} tenants</Tag>}
        actions={
          canManage && opened ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setAdding({ parentId: null })}
              data-testid="new-department"
            >
              Add department
            </Button>
          ) : undefined
        }
      />

      {!canManage && (
        <Alert
          className="nu-block"
          type="info"
          showIcon
          data-testid="read-only"
          message="You can read the structure but not change it."
          description="Redrawing the company needs `orgs.manage`."
        />
      )}

      <div className="nu-orgsplit">
        <Card size="small" title="Tenants" className="nu-orglist" data-testid="org-list">
          {listing.isLoading && <Skeleton active paragraph={{ rows: 4 }} />}
          <ul>
            {organizations.map((org) => (
              <li key={org.id}>
                <button
                  type="button"
                  className={org.id === opened ? "is-active" : undefined}
                  aria-pressed={org.id === opened}
                  onClick={() => setParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set("org", org.id);
                    return next;
                  }, { replace: true })}
                  data-testid={`org-${org.slug}`}
                >
                  <span className="nu-orglist-name">{org.name}</span>
                  <span className="nu-orglist-meta">
                    <Tag bordered={false}>{org.tier.toLowerCase()}</Tag>
                    {/* Counted, not claimed — see `api/organizations.ts`. */}
                    {org.people} {org.people === 1 ? "account" : "accounts"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <div className="nu-orgstructure">
          {tree.isLoading && <Skeleton active paragraph={{ rows: 10 }} />}
          {tree.isError && (
            <Alert
              type="error"
              showIcon
              message={
                tree.error instanceof ApiError
                  ? tree.error.message
                  : "That structure could not be read."
              }
            />
          )}
          {tree.data && (
            <Structure
              tree={tree.data}
              catalogue={catalogue.data!}
              canManage={canManage}
              onAdd={(parentId) => setAdding({ parentId })}
              onMove={(id, parentId) => moveDepartment.mutate({ id, parentId })}
              onRemove={(id) => removeDepartment.mutate(id)}
              busy={moveDepartment.isPending || removeDepartment.isPending}
            />
          )}
        </div>
      </div>

      <Modal
        open={adding !== null}
        onCancel={requestClose}
        title={adding?.parentId ? "Add a sub-department" : "Add a department"}
        okText="Add it"
        confirmLoading={addDepartment.isPending}
        onOk={() => {
          void form
            .validateFields()
            .then((values: { name: string; code: string }) =>
              addDepartment.mutate({ ...values, parent_id: adding?.parentId ?? null }),
            )
            .catch(() => {
              // The form is already showing why; swallowed so an empty field
              // does not become an unhandled rejection.
            });
        }}
        okButtonProps={{ "data-testid": "create-department" }}
      >
        <Form form={form} layout="vertical" data-testid="department-form" onValuesChange={touch}>
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: "A department needs a name." }]}
          >
            <Input autoFocus maxLength={120} placeholder="Platform Engineering" aria-label="Department name" />
          </Form.Item>
          <Form.Item
            name="code"
            label="Code"
            rules={[{ required: true, message: "A department needs a code." }]}
            extra="Letters, digits and dashes. Upper-cased for you."
          >
            <Input maxLength={32} placeholder="ENG-PLT" aria-label="Department code" />
          </Form.Item>
          <Form.Item name="description" label="What it does">
            <Input.TextArea rows={2} maxLength={240} aria-label="Department description" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/** One organisation: its own details, its unplaced people, and its tree. */
function Structure({
  tree,
  catalogue,
  canManage,
  onAdd,
  onMove,
  onRemove,
  busy,
}: {
  tree: OrgTree;
  catalogue: OrgCatalogue;
  canManage: boolean;
  onAdd: (parentId: string | null) => void;
  onMove: (id: string, parentId: string | null) => void;
  onRemove: (id: string) => void;
  busy: boolean;
}) {
  const org = tree.organization;
  const full = tree.depth >= tree.max_depth;

  return (
    <Space direction="vertical" size={12} className="nu-block">
      <Card size="small" data-testid="org-summary">
        <div className="nu-orgstats">
          {/* The two numbers, side by side and labelled, because they are
              different facts: a tenant of 4,000 staff with 30 accounts is
              normal and neither figure is wrong. */}
          <Statistic
            title="Accounts here"
            value={org.people}
            formatter={(value) => formatNumber(Number(value))}
          />
          <Statistic
            title="Employees on record"
            value={org.employee_count}
            formatter={(value) => formatNumber(Number(value))}
          />
          <Statistic title="Departments" value={org.department_count} />
          <Statistic title="Teams" value={org.team_count} />
          {/* Absent for a reader without `orgs.manage` — the server withholds
              it rather than sending nought, so this is "not shown to you"
              and not "nothing". Drawn only when it is there. */}
          {org.annual_revenue !== undefined && (
            <Statistic
              title="Annual revenue"
              value={org.annual_revenue}
              formatter={(value) => formatNumber(Number(value))}
            />
          )}
        </div>
        <Descriptions
          size="small"
          column={2}
          className="nu-block"
          items={[
            { key: "tier", label: "Tier", children: org.tier.toLowerCase() },
            { key: "status", label: "Status", children: org.status.toLowerCase() },
            { key: "industry", label: "Industry", children: org.industry ?? "—" },
            {
              key: "where",
              label: "Where",
              children: [org.city, org.country].filter(Boolean).join(", ") || "—",
            },
          ]}
        />
      </Card>

      {/* The reason a tree can sum to less than the tenant's total, on the
          screen rather than left as a discrepancy (§34). */}
      {(tree.unassigned_people > 0 || tree.unplaced_teams.length > 0) && (
        <Alert
          type="info"
          showIcon
          data-testid="unplaced"
          message="Not everything sits in a department"
          description={
            [
              tree.unassigned_people > 0
                ? `${tree.unassigned_people} ${tree.unassigned_people === 1 ? "person is" : "people are"} in no department`
                : null,
              tree.unplaced_teams.length > 0
                ? `${tree.unplaced_teams.length} ${tree.unplaced_teams.length === 1 ? "team" : "teams"} belong to no department: ${tree.unplaced_teams.map((team) => team.name).join(", ")}`
                : null,
            ]
              .filter(Boolean)
              .join(". ") + "."
          }
        />
      )}

      {full && (
        <Alert
          type="warning"
          showIcon
          data-testid="depth-reached"
          message={`The structure is ${tree.max_depth} levels deep, which is as far as it goes`}
          description="Past that the indentation runs out of room before the data runs out of depth."
        />
      )}

      <Card
        size="small"
        title={
          <Space size={6}>
            <ApartmentOutlined /> Structure
            <Text type="secondary">
              ({tree.depth + 1} {tree.depth === 0 ? "level" : "levels"})
            </Text>
          </Space>
        }
        data-testid="org-tree"
      >
        {tree.departments.length === 0 ? (
          <EmptyState compact title="No departments yet." />
        ) : (
          <ul className="nu-orgtree" role="tree" aria-label="Department structure">
            {tree.departments.map((node) => (
              <Branch
                key={node.id}
                node={node}
                all={tree.departments}
                maxDepth={tree.max_depth}
                canManage={canManage}
                busy={busy}
                onAdd={onAdd}
                onMove={onMove}
                onRemove={onRemove}
              />
            ))}
          </ul>
        )}
        {catalogue.regions.length > 0 && (
          <Text type="secondary" className="nu-orgregions">
            {catalogue.regions.length} regions configured:{" "}
            {catalogue.regions.map((region) => region.code).join(", ")}
          </Text>
        )}
      </Card>
    </Space>
  );
}

/** One department and everything under it. */
function Branch({
  node,
  all,
  maxDepth,
  canManage,
  busy,
  onAdd,
  onMove,
  onRemove,
}: {
  node: DepartmentNode;
  all: DepartmentNode[];
  maxDepth: number;
  canManage: boolean;
  busy: boolean;
  onAdd: (parentId: string | null) => void;
  onMove: (id: string, parentId: string | null) => void;
  onRemove: (id: string) => void;
}) {
  const destinations = canManage ? movableInto(all, node.id, maxDepth) : [];

  return (
    <li role="treeitem" aria-expanded={node.children.length > 0 || undefined}>
      <div className="nu-orgnode" data-testid={`dept-${node.code}`}>
        <span className="nu-orgnode-what">
          <Text strong>{node.name}</Text>
          <Text type="secondary" className="nu-orgnode-code">
            {node.code}
            {node.cost_center ? ` · ${node.cost_center}` : ""}
          </Text>
        </span>

        {/* Two numbers, labelled — see `peopleLabel`. */}
        <Text type="secondary" className="nu-orgnode-people">
          {peopleLabel(node)}
        </Text>

        {node.manager && (
          <span className="nu-orgnode-manager">
            <PersonAvatar
              size={20}
              name={node.manager.full_name}
              initials={node.manager.initials}
              src={node.manager.avatar_url}
            />
            <Text type="secondary">{node.manager.full_name}</Text>
          </span>
        )}

        {node.teams.length > 0 && (
          <Space size={[4, 4]} wrap className="nu-orgnode-teams">
            {node.teams.map((team) => (
              <Tooltip
                key={team.id}
                title={team.lead ? `Led by ${team.lead.full_name}` : team.description ?? undefined}
              >
                <Tag bordered={false} icon={<TeamOutlined />}>
                  {team.name}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        )}

        {canManage && (
          <Space size={2} className="nu-orgnode-acts">
            {node.depth < maxDepth - 1 && (
              <Tooltip title="Add a department inside this one">
                <Button
                  type="text"
                  icon={<PlusOutlined />}
                  aria-label={`Add inside ${node.name}`}
                  data-testid={`add-in-${node.code}`}
                  onClick={() => onAdd(node.id)}
                />
              </Tooltip>
            )}
            <Select
              size="small"
              aria-label={`Move ${node.name}`}
              value={node.parent_id ?? "root"}
              disabled={busy}
              style={{ width: 150 }}
              data-testid={`move-${node.code}`}
              onChange={(next) => onMove(node.id, next === "root" ? null : next)}
              options={[
                { value: "root", label: "At the top" },
                // Its own subtree is pruned rather than offered and refused:
                // a control that produces an error on purpose is not a control.
                ...destinations.map((item) => ({
                  value: item.id,
                  label: `${"— ".repeat(item.depth)}${item.label}`,
                })),
              ]}
            />
            <Popconfirm
              title={`Retire ${node.name}?`}
              description={
                node.people_in_subtree > 0 || node.teams.length > 0 || node.children.length > 0
                  ? "It still has people, teams or sub-departments in it — this will be refused until they are moved."
                  : "Nothing is in it, so nothing else changes."
              }
              okText="Retire it"
              okButtonProps={{ danger: true }}
              onConfirm={() => onRemove(node.id)}
            >
              {/* No Tooltip around this one. A Tooltip inside a Popconfirm
                  renders a *second* popover that sits over the confirmation
                  and intercepts the click — the same mistake the jobs table
                  made, found the same way. The button's accessible name and
                  the confirmation's own title already say "Retire", so the
                  hint was a third copy of the word as well as a bug. */}
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label={`Retire ${node.name}`}
                data-testid={`retire-${node.code}`}
              />
            </Popconfirm>
          </Space>
        )}
      </div>

      {node.children.length > 0 && (
        <ul role="group">
          {node.children.map((child) => (
            <Branch
              key={child.id}
              node={child}
              all={all}
              maxDepth={maxDepth}
              canManage={canManage}
              busy={busy}
              onAdd={onAdd}
              onMove={onMove}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
