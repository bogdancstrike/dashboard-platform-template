import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { SorterResult } from "antd/es/table/interface";
import { ClearOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { usersApi, type UserQuery, type UserRow } from "@/api/users";
import { EmptyState, NoResults } from "@/components/EmptyState";
import { EdgeTag } from "@/components/EdgeTag";
import { StatusTag } from "@/components/StatusTag";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { absoluteTime, relativeTime } from "@/lib/time";
import { PersonAvatar } from "@/components/PersonAvatar";

const { Text } = Typography;

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
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const page = Number(params.get("page") ?? 1) || 1;
  const pageSize = Number(params.get("page_size") ?? 25) || 25;
  const sort = params.get("sort") ?? "full_name";
  const order = params.get("order") === "desc" ? "desc" : "asc";
  const term = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const roleCode = params.get("role_code") ?? "";

  const [search, setSearch] = useState(term);
  const debounced = useDebouncedValue(search, 280);

  useEffect(() => setSearch(term), [term]);
  useEffect(() => {
    if (debounced !== term) set({ q: debounced || null, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const set = (changes: Record<string, string | number | null>, replace = true) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        Object.entries(changes).forEach(([key, value]) => {
          if (value === null || value === "") next.delete(key);
          else next.set(key, String(value));
        });
        return next;
      },
      { replace },
    );
  };

  const query = useMemo<UserQuery>(
    () => ({
      page,
      page_size: pageSize,
      sort,
      order,
      q: term || undefined,
      status: status || undefined,
      role_code: roleCode || undefined,
    }),
    [page, pageSize, sort, order, term, status, roleCode],
  );

  const people = useQuery({
    queryKey: ["admin", "users", query],
    queryFn: ({ signal }) => usersApi.list(query, signal),
    placeholderData: (previous) => previous,
  });

  const filterCount = (term ? 1 : 0) + (status ? 1 : 0) + (roleCode ? 1 : 0);
  const clearFilters = () => setParams(new URLSearchParams());

  usePageCommands("users", [
    {
      id: "users.suspended",
      label: "Show suspended accounts",
      keywords: "disabled locked",
      run: () => set({ status: "SUSPENDED", page: null }),
    },
    {
      id: "users.roles",
      label: "Open the permission matrix",
      keywords: "roles permissions",
      run: () => navigate("/admin/roles"),
    },
  ]);

  const columns: ColumnsType<UserRow> = [
    {
      title: "Name",
      dataIndex: "full_name",
      sorter: true,
      defaultSortOrder: order === "asc" ? "ascend" : "descend",
      render: (name: string, row) => (
        <Space size={10}>
          <PersonAvatar
            size="small"
            src={row.avatar_url}
            initials={row.initials}
            icon={!row.avatar_url ? <UserOutlined /> : undefined}
          />
          <Space direction="vertical" size={0} style={{ lineHeight: 1.3 }}>
            <Text>{name}</Text>
            <Text type="secondary">{row.email}</Text>
          </Space>
        </Space>
      ),
    },
    {
      title: "Role",
      dataIndex: "role_code",
      width: 200,
      sorter: true,
      render: (_code: string | null, row) => (
        <Space size={4} wrap>
          {row.role_name ? (
            <EdgeTag color={row.role_color}>{row.role_name}</EdgeTag>
          ) : (
            <Text type="secondary">No role</Text>
          )}
          {/* Groups add permissions on top of the role, so an administrator
              looking at "why can they do that?" needs them here too. */}
          {row.group_names.map((group) => (
            <Tooltip key={group} title="Adds permissions on top of the role">
              <Tag>{group}</Tag>
            </Tooltip>
          ))}
        </Space>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 130,
      sorter: true,
      render: (value: string) => <StatusTag status={value} />,
    },
    {
      title: "Last sign-in",
      dataIndex: "last_login_at",
      width: 150,
      sorter: true,
      render: (value: string | null) =>
        value ? (
          <Tooltip title={absoluteTime(value)}>
            <Text>{relativeTime(value)}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">Never</Text>
        ),
    },
    {
      title: "MFA",
      dataIndex: "mfa_enabled",
      width: 90,
      align: "center",
      render: (enabled: boolean) =>
        enabled ? (
          <Tooltip title="Multi-factor authentication is on">
            <SafetyCertificateOutlined className="nu-mfa-on" />
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ];

  const onTableChange = (
    pagination: TablePaginationConfig,
    _filters: unknown,
    sorter: SorterResult<UserRow> | SorterResult<UserRow>[],
  ) => {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof single?.field === "string" ? single.field : sort;
    set({
      page: pagination.current === 1 ? null : (pagination.current ?? null),
      page_size: pagination.pageSize === 25 ? null : (pagination.pageSize ?? null),
      sort: single?.order ? field : null,
      order: single?.order === "descend" ? "desc" : null,
    });
  };

  const roleOptions = (people.data?.facets["role_code"] ?? []).map((facet) => ({
    value: facet.value,
    label: `${facet.value} · ${facet.count}`,
  }));
  const statusOptions = (people.data?.facets["status"] ?? []).map((facet) => ({
    value: facet.value,
    label: `${facet.value} · ${facet.count}`,
  }));

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Who can sign in, what their role lets them do, and when they last did."
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

      <Card size="small" className="nu-filter-bar" data-testid="user-filters">
        <Space wrap size={8} align="center">
          <Input.Search
            allowClear
            placeholder="Search name, email or username"
            aria-label="Search people"
            style={{ width: 300 }}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            allowClear
            placeholder="Role"
            aria-label="Role"
            style={{ minWidth: 180 }}
            value={roleCode || undefined}
            options={roleOptions}
            onChange={(value?: string) => set({ role_code: value ?? null, page: null })}
          />
          <Select
            allowClear
            placeholder="Status"
            aria-label="Status"
            style={{ minWidth: 180 }}
            value={status || undefined}
            options={statusOptions}
            onChange={(value?: string) => set({ status: value ?? null, page: null })}
          />
        </Space>
      </Card>

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
          description={
            people.error instanceof ApiError ? (
              <Space direction="vertical" size={4}>
                {people.error.missingPermissions.length > 0 && (
                  <Text type="secondary">
                    Missing: {people.error.missingPermissions.join(", ")}
                  </Text>
                )}
                <Text code copyable={{ text: people.error.correlationId }}>
                  {people.error.correlationId}
                </Text>
              </Space>
            ) : undefined
          }
          action={
            <Button onClick={() => void people.refetch()}>
              Retry
            </Button>
          }
        />
      )}

      <Card size="small" className="nu-block">
        <Table<UserRow>
          data-testid="user-table"
          rowKey="id"
          size="small"
          columns={columns}
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
            current: people.data?.page ?? page,
            pageSize: people.data?.page_size ?? pageSize,
            total: people.data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [25, 50, 100, 200],
            showTotal: (total, range) => `${range[0]}–${range[1]} of ${total.toLocaleString()}`,
          }}
        />
      </Card>
    </>
  );
}
