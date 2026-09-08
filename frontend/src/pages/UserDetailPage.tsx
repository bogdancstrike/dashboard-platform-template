import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Descriptions,
  Popconfirm,
  Row,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { SafetyCertificateOutlined, UserOutlined, UserSwitchOutlined } from "@ant-design/icons";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { rolesApi } from "@/api/roles";
import {
  usersApi,
  type SignInRow,
  type UserDetail,
  type UserSessionRow,
} from "@/api/users";
import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { PageHeader } from "@/components/PageHeader";
import { useImpersonation } from "@/auth/ImpersonationProvider";
import { usePageCommands } from "@/commands/CommandContext";
import { absoluteTime, relativeTime } from "@/lib/time";
import { knownStatusColor } from "@/theme/tokens";
import { PersonAvatar } from "@/components/PersonAvatar";

const { Text } = Typography;

/**
 * One person (§12).
 *
 * The tab that matters is **Access**, and it answers a question a role alone
 * cannot: *why* can this person do that? Permissions arrive from two places —
 * the role and every group they are in — and the API enforces the union. A
 * screen showing only "Role: Manager" leaves an administrator staring at
 * somebody who can cancel jobs with no way to find out how.
 */
export default function UserDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const impersonation = useImpersonation();
  const tab = params.get("tab") ?? "access";

  const person = useQuery({
    queryKey: ["admin", "user", id],
    queryFn: ({ signal }) => usersApi.get(id, signal),
    enabled: Boolean(id),
  });

  // Only fetched when there is something to do with it: a reader who cannot
  // manage anybody has no use for the list of roles.
  const roles = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: ({ signal }) => rolesApi.matrix(signal),
    enabled: person.data?.can_manage === true,
    staleTime: 300_000,
  });

  const change = useMutation({
    mutationFn: (body: { status?: string; role_code?: string }) => usersApi.update(id, body),
    onSuccess: async (updated) => {
      queryClient.setQueryData(["admin", "user", id], updated);
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      message.success(`${updated.full_name} updated. It applies on their next request.`);
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError
          ? `${error.message}${error.correlationId ? ` · ${error.correlationId}` : ""}`
          : "The change could not be saved.",
      ),
  });

  usePageCommands("user-detail", [
    {
      id: "user.audit",
      label: "Show everything this person has done",
      keywords: "audit history activity",
      run: () => navigate(`/admin/audit?actor_label=${encodeURIComponent(person.data?.full_name ?? "")}`),
    },
  ]);

  if (person.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (person.isError) {
    const error = person.error;
    const missing = error instanceof ApiError && error.isNotFound;
    return (
      <>
        <PageHeader
          title={missing ? "Person not found" : "Could not open this profile"}
          onBack={() => navigate("/admin/users")}
        />
        <Alert
          type={missing ? "warning" : "error"}
          showIcon
          message={
            missing
              ? "The account may have been removed, or the link may be wrong."
              : error instanceof ApiError
                ? error.message
                : "The request failed."
          }
        />
      </>
    );
  }

  const user = person.data!;

  const startImpersonating = async () => {
    try {
      const target = await impersonation.start(user.id);
      message.success(`You are now acting as ${target.full_name}.`);
      navigate("/dashboard");
    } catch (error) {
      message.error(
        error instanceof ApiError ? error.message : "That impersonation was refused.",
      );
    }
  };

  return (
    <>
      <PageHeader
        title={
          <Space size={10}>
            <PersonAvatar
              src={user.avatar_url}
              initials={user.initials}
              icon={!user.avatar_url ? <UserOutlined /> : undefined}
            />
            {user.full_name}
          </Space>
        }
        onBack={() => navigate("/admin/users")}
        subtitle={
          <Space size={10} wrap>
            <Text type="secondary">{user.email}</Text>
            {user.job_title && <Text type="secondary">{user.job_title}</Text>}
            {user.organization && <Text type="secondary">{user.organization.name}</Text>}
          </Space>
        }
        tag={
          <Space size={6}>
            <Tag color={knownStatusColor(user.status)} data-testid="user-status">
              {user.status}
            </Tag>
            {user.role_name && <Tag color={user.role_color}>{user.role_name}</Tag>}
            {user.mfa_enabled && (
              <Tooltip title="Multi-factor authentication is on">
                <Tag icon={<SafetyCertificateOutlined />}>MFA</Tag>
              </Tooltip>
            )}
          </Space>
        }
        actions={
          <>
            {user.can_manage && (
              <Space.Compact>
                <Select
                  aria-label="Role"
                  style={{ minWidth: 170 }}
                  value={user.role_code ?? undefined}
                  placeholder="No role"
                  loading={roles.isLoading}
                  disabled={change.isPending}
                  options={(roles.data?.items ?? []).map((role) => ({
                    value: role.code,
                    label: role.name,
                  }))}
                  onChange={(code: string) => change.mutate({ role_code: code })}
                />
                <Select
                  aria-label="Account status"
                  style={{ minWidth: 150 }}
                  value={user.status}
                  disabled={change.isPending}
                  options={["ACTIVE", "INVITED", "SUSPENDED", "DISABLED"].map((value) => ({
                    value,
                    label: value,
                  }))}
                  onChange={(status: string) => change.mutate({ status })}
                />
              </Space.Compact>
            )}
            {user.can_impersonate ? (
              <Popconfirm
                title={`Act as ${user.full_name}?`}
                description="You will see the platform exactly as they do. Every action is audited under both names."
                okText="Start"
                onConfirm={() => void startImpersonating()}
              >
                <Button icon={<UserSwitchOutlined />} data-testid="impersonate">
                  View as this person
                </Button>
              </Popconfirm>
            ) : (
              user.impersonation_blocked_because && (
                <Tooltip title={user.impersonation_blocked_because}>
                  <Button icon={<UserSwitchOutlined />} disabled data-testid="impersonate">
                    View as this person
                  </Button>
                </Tooltip>
              )
            )}
          </>
        }
      />

      <Tabs
        activeKey={tab}
        onChange={(key) =>
          setParams(
            (current) => {
              const next = new URLSearchParams(current);
              if (key === "access") next.delete("tab");
              else next.set("tab", key);
              return next;
            },
            { replace: true },
          )
        }
        items={[
          { key: "access", label: "Access", children: <Access user={user} /> },
          {
            key: "profile",
            label: "Profile",
            children: <Profile user={user} />,
          },
          {
            key: "security",
            label: "Sessions & sign-ins",
            children: <Security sessions={user.sessions} signIns={user.sign_ins} />,
          },
          {
            key: "history",
            label: "History",
            children: (
              <Card size="small">
                <AuditTimeline resourceType="user" resourceId={user.id} />
              </Card>
            ),
          },
        ]}
      />
    </>
  );
}

/** Why this person can do what they can: role, plus groups, plus the union. */
function Access({ user }: { user: UserDetail }) {
  const { access, groups } = user;
  const fromGroups = new Set(access.from_groups_only);

  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={14}>
        <Card
          size="small"
          title={`Effective permissions · ${access.effective.length}`}
          data-testid="effective-permissions"
        >
          <Space size={[6, 6]} wrap>
            {access.effective.length === 0 && (
              <Text type="secondary">This account can do nothing at all.</Text>
            )}
            {access.effective.map((permission) => (
              <Tooltip
                key={permission}
                title={
                  fromGroups.has(permission)
                    ? "Granted by a group, not by the role"
                    : "Granted by the role"
                }
              >
                {/* The group-granted half is marked, because it is the half a
                    role-shaped screen cannot explain. */}
                <Tag color={fromGroups.has(permission) ? "purple" : undefined}>{permission}</Tag>
              </Tooltip>
            ))}
          </Space>
        </Card>
      </Col>
      <Col xs={24} xl={10}>
        <Card size="small" title="Where it comes from">
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Role">
              {user.role_name ? (
                <Space direction="vertical" size={2}>
                  <Tag color={user.role_color}>{user.role_name}</Tag>
                  <Text type="secondary">
                    {access.role_permissions.length} permission
                    {access.role_permissions.length === 1 ? "" : "s"}
                  </Text>
                </Space>
              ) : (
                <Text type="secondary">No role</Text>
              )}
            </Descriptions.Item>
            {groups.length === 0 ? (
              <Descriptions.Item label="Groups">
                <Text type="secondary">None</Text>
              </Descriptions.Item>
            ) : (
              groups.map((group) => (
                <Descriptions.Item key={group.id} label={group.name}>
                  <Space size={[4, 4]} wrap>
                    {group.permissions.length === 0 ? (
                      <Text type="secondary">Adds nothing</Text>
                    ) : (
                      group.permissions.map((permission) => (
                        <Tag key={permission} color="purple">
                          {permission}
                        </Tag>
                      ))
                    )}
                  </Space>
                </Descriptions.Item>
              ))
            )}
          </Descriptions>
        </Card>
      </Col>
    </Row>
  );
}

function Profile({ user }: { user: UserDetail }) {
  return (
    <Card size="small">
      <Descriptions size="small" column={{ xs: 1, md: 2 }} bordered>
        <Descriptions.Item label="Username">{user.username}</Descriptions.Item>
        <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
        <Descriptions.Item label="Phone">
          {user.phone || <Text type="secondary">—</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Job title">
          {user.job_title || <Text type="secondary">—</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Organization">
          {user.organization?.name ?? <Text type="secondary">—</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Department">
          {user.department?.name ?? <Text type="secondary">—</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Manager">
          {user.manager?.name ?? <Text type="secondary">—</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Locale">
          {user.locale} · {user.timezone}
        </Descriptions.Item>
        <Descriptions.Item label="Sign-ins">{user.login_count}</Descriptions.Item>
        <Descriptions.Item label="Last sign-in">
          {user.last_login_at ? (
            <Tooltip title={absoluteTime(user.last_login_at)}>
              <span>{relativeTime(user.last_login_at)}</span>
            </Tooltip>
          ) : (
            <Text type="secondary">Never</Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Profile complete">
          {user.profile_completeness}%
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

function Security({
  sessions,
  signIns,
}: {
  sessions: UserSessionRow[];
  signIns: SignInRow[];
}) {
  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={12}>
        <Card size="small" title="Sessions">
          <Table<UserSessionRow>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={sessions}
            locale={{ emptyText: "No sessions on record." }}
            columns={[
              { title: "Device", dataIndex: "device", ellipsis: true },
              { title: "Address", dataIndex: "ip_address", width: 140 },
              {
                title: "Last seen",
                dataIndex: "last_seen_at",
                width: 130,
                render: (value: string | null) => relativeTime(value),
              },
              {
                title: "",
                dataIndex: "revoked",
                width: 90,
                render: (revoked: boolean) =>
                  revoked ? <Tag>revoked</Tag> : <Tag color="green">live</Tag>,
              },
            ]}
          />
        </Card>
      </Col>
      <Col xs={24} xl={12}>
        <Card size="small" title="Recent sign-ins">
          <Table<SignInRow>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={signIns}
            locale={{ emptyText: "No sign-ins on record." }}
            columns={[
              {
                title: "Result",
                dataIndex: "result",
                width: 110,
                render: (value: string) => (
                  <Tag color={value === "SUCCESS" ? "green" : "red"}>{value}</Tag>
                ),
              },
              { title: "Address", dataIndex: "ip_address", width: 140 },
              { title: "Method", dataIndex: "method", width: 110 },
              {
                title: "When",
                dataIndex: "at",
                width: 130,
                render: (value: string | null) => relativeTime(value),
              },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}
