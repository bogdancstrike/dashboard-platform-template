import { Alert, Button, Card, Tag } from "antd";
import { ClearOutlined, SafetyCertificateOutlined } from "@ant-design/icons";

import { ApiError } from "@/api/client";
import type { UserRow } from "@/api/users";
import { EmptyState, NoResults } from "@/components/EmptyState";
import { apiErrorDetails } from "@/components/feedback/apiErrorDetails";
import { ResponsiveTable } from "@/components/listing/ResponsiveTable";
import { PageHeader } from "@/components/PageHeader";

import { StatusChips, UserFilters } from "./UserFilters";
import { userCard, userColumns } from "./userColumns";
import { useUsersPage } from "./useUsersPage";

/**
 * The people directory (§12).
 *
 * Filtered, sorted and faceted in SQL like every other list — including by
 * role, which lives on another table and is joined rather than filtered in the
 * browser. The columns are the four things an administrator is actually
 * looking for: who they are, what they may do, whether the account is live,
 * and when it was last used.
 */
export default function UsersPage() {
  const users = useUsersPage();
  const { navigate, people, filterCount, clearFilters } = users;
  const invited = (people.data?.facets["status"] ?? []).find((facet) => facet.value === "INVITED")?.count ?? 0;

  return (
    <div className="nx-ad nx-ad--users">
      <PageHeader
        title="Users"
        subtitle={
          people.data
            ? `${people.data.total.toLocaleString()} ${people.data.total === 1 ? "person" : "people"}${
                invited ? ` · ${invited.toLocaleString()} invitation${invited === 1 ? "" : "s"} pending` : ""
              } — who can sign in, what their role lets them do, and when they last did.`
            : "Who can sign in, what their role lets them do, and when they last did."
        }
        tag={
          people.data ? (
            <Tag color="blue" data-testid="user-total">
              {people.data.total.toLocaleString()} people
            </Tag>
          ) : undefined
        }
        actions={
          <>
            {filterCount > 0 && (
              <Button icon={<ClearOutlined />} onClick={clearFilters}>
                Clear {filterCount} filter{filterCount === 1 ? "" : "s"}
              </Button>
            )}
            <Button
              icon={<SafetyCertificateOutlined />}
              onClick={() => navigate("/admin/roles")}
            >
              Roles & permissions
            </Button>
          </>
        }
      />

      <UserFilters page={users} />

      <StatusChips page={users} />

      {people.isError && (
        <Alert
          className="nu-block"
          type={people.error instanceof ApiError && people.error.isForbidden ? "warning" : "error"}
          showIcon
          message={
            people.error instanceof ApiError && people.error.isForbidden
              ? "You do not have permission to see the people directory"
              : "The directory could not be loaded"
          }
          description={apiErrorDetails(people.error)}
          action={
            <Button onClick={() => void people.refetch()}>
              Retry
            </Button>
          }
        />
      )}

      <UsersTable page={users} />
    </div>
  );
}

/** The people, as a table on a desk and cards on a phone; a row opens the person. */
function UsersTable({ page }: { page: ReturnType<typeof useUsersPage> }) {
  const { navigate, page: current, pageSize, order, people, filterCount, clearFilters, onTableChange } = page;
  return (
    <Card size="small" className="nu-block">
      <ResponsiveTable<UserRow>
        card={userCard}
        data-testid="user-table"
        rowKey="id"
        size="small"
        columns={userColumns(order)}
        dataSource={people.data?.items ?? []}
        loading={people.isLoading}
        onChange={onTableChange}
        scroll={{ x: 860 }}
        onRow={(row) => ({
          onClick: () => navigate(`/admin/users/${row.id}`),
          style: { cursor: "pointer" },
        })}
        locale={{
          emptyText: people.isLoading ? (
            " "
          ) : filterCount > 0 ? (
            <NoResults filterCount={filterCount} onClear={clearFilters} />
          ) : (
            <EmptyState title="Nobody has been provisioned yet" />
          ),
        }}
        pagination={{
          current: people.data?.page ?? current,
          pageSize: people.data?.page_size ?? pageSize,
          total: people.data?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100, 200],
          showTotal: (total, range) => `Showing ${range[0]}–${range[1]} of ${total.toLocaleString()}`,
        }}
      />
    </Card>
  );
}
