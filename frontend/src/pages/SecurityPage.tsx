/**
 * `/settings/security` — your own sessions, sign-ins and warnings (§41).
 *
 * Six decisions worth the reader's attention.
 *
 * **This page needs no permission, and that is deliberate.** Being signed in is
 * the qualification for seeing your own sessions. A security page that had to be
 * granted would be one most people never see, and its whole value is that the
 * person whose account it is can look without asking anybody. It is reached
 * from the profile menu rather than the navigation, because it is about *you*
 * rather than about the platform.
 *
 * **The page opens with a sentence, not a row of numbers.** "Is anything wrong"
 * is the question, and four counters make a reader do the arithmetic
 * themselves. The one number that earns its own line is the failed sign-in
 * count, and only once there have been enough of them to mean something — the
 * server decides that, so the threshold is not a browser's opinion.
 *
 * **Failed sign-ins are not merged into a history list.** Somebody trying your
 * password from an address you do not recognise is exactly what this page
 * exists to show, so failures have their own filter, their own colour and their
 * own line at the top. A "recent activity" feed that mixed them with successes
 * would bury the only rows that matter.
 *
 * **The session you are using is marked, and revoking it is a separate act.**
 * Signing yourself out is a reasonable thing to want, but pressing "revoke"
 * down a list and landing on your own row is how somebody loses their work —
 * so it carries a different confirmation that says what will happen.
 *
 * **Every control asks the server whether it is allowed.** `can_revoke` arrives
 * on each row; this page never decides for itself whether a session may be
 * signed out. An expired one has nothing to revoke, and a button that
 * changed nothing would be worse than no button (§76).
 *
 * **Nothing here deletes.** A session is revoked, an event is resolved, and
 * the history is a record — a security page whose rows can be tidied away is
 * one an attacker tidies away.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Popconfirm,
  Segmented,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";

import {
  securityApi,
  type SecurityEvent,
  type SecurityOverview,
  type SecuritySeverity,
  type SessionState,
  type SignIn,
  type SignInSession,
} from "@/api/security";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { errorText } from "@/lib/errors";
import { formatNumber } from "@/lib/formats";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text, Paragraph } = Typography;

/**
 * The sentence the page opens with.
 *
 * One sentence rather than four counters, because the question is "is anything
 * wrong" and a row of numbers makes the reader answer it themselves. Ordered
 * by what would worry somebody: failed sign-ins first, then unresolved
 * warnings, then how many devices are signed in.
 */
export function headline(overview: SecurityOverview): string {
  if (overview.failures_worth_saying) {
    const where = overview.failure_addresses.length
      ? ` from ${overview.failure_addresses.length === 1 ? "an address" : "addresses"} including ${overview.failure_addresses[0]}`
      : "";
    return `${formatNumber(overview.failed_sign_ins)} failed sign-ins in the last ${
      overview.window_days
    } days${where}. If none of those were you, sign out everywhere and change your password.`;
  }
  if (overview.unresolved_events) {
    return overview.unresolved_events === 1
      ? "One security event has not been looked at."
      : `${formatNumber(overview.unresolved_events)} security events have not been looked at.`;
  }
  if (overview.other_sessions) {
    return overview.other_sessions === 1
      ? "You are signed in on one other device. Nothing else needs attention."
      : `You are signed in on ${formatNumber(
          overview.other_sessions,
        )} other devices. Nothing else needs attention.`;
  }
  return "This is the only device you are signed in on, and nothing needs attention.";
}

/** Whether that sentence is a warning or a reassurance. */
export function headlineTone(overview: SecurityOverview): "error" | "warning" | "success" {
  if (overview.failures_worth_saying) return "error";
  if (overview.unresolved_events) return "warning";
  return "success";
}

/**
 * What one session's state comes to, in words.
 *
 * Three states and the one that matters is the difference between "somebody
 * signed this out" and "this ran out on its own" — a page saying "inactive"
 * for both would hide the only one anybody acted on.
 */
export function sessionSituation(row: SignInSession): string {
  if (row.current) return "This device, right now";
  if (row.state === "REVOKED") return "Signed out";
  if (row.state === "EXPIRED") return "Expired on its own";
  return row.trusted ? "Signed in — a device you recognise" : "Signed in";
}

/**
 * The colour a session earns, and why an ordinary one earns none.
 *
 * Only the one you are using is worth marking, plus an untrusted live session
 * — which is the row somebody scans for. Revoked and expired are ordinary
 * history, and colouring them would spend the reader's attention on rows
 * nothing can be done about (§64).
 */
export function sessionTone(row: SignInSession): "success" | "warning" | undefined {
  if (row.current) return "success";
  if (row.state === "ACTIVE" && !row.trusted) return "warning";
  return undefined;
}

/** A security event's severity as AntD names its colours. */
export function severityTone(severity: SecuritySeverity): string | undefined {
  return { CRITICAL: "error", WARNING: "warning", INFO: undefined }[severity];
}

const STATE_LABELS: Record<SessionState, string> = {
  ACTIVE: "Signed in",
  EXPIRED: "Expired",
  REVOKED: "Signed out",
};

export default function SecurityPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [signInFilter, setSignInFilter] = useState<"all" | "FAILURE">("all");

  const overview = useQuery({
    queryKey: ["security", "overview"],
    queryFn: ({ signal }) => securityApi.overview(signal),
  });
  const sessions = useQuery({
    queryKey: ["security", "sessions"],
    queryFn: ({ signal }) => securityApi.sessions(signal),
  });
  const signIns = useQuery({
    queryKey: ["security", "sign-ins", signInFilter],
    queryFn: ({ signal }) =>
      securityApi.signIns(
        { ...(signInFilter === "all" ? {} : { result: signInFilter }), page_size: 25 },
        signal,
      ),
  });
  const events = useQuery({
    queryKey: ["security", "events"],
    queryFn: ({ signal }) => securityApi.events({ page_size: 25 }, signal),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["security"] });
  };

  const revoked = useMutation({
    mutationFn: (id: string) => securityApi.revoke(id),
    onSuccess: async () => {
      await refresh();
      message.success("That device has been signed out.");
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "sign that device out" }));
    },
  });

  const sweptOthers = useMutation({
    mutationFn: () => securityApi.revokeOthers(),
    onSuccess: async (answer) => {
      await refresh();
      message.success(
        answer.revoked === 0
          ? "There was nowhere else signed in."
          : answer.revoked === 1
            ? "One other device has been signed out."
            : `${formatNumber(answer.revoked)} other devices have been signed out.`,
      );
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "sign the other devices out" }));
    },
  });

  const trusted = useMutation({
    mutationFn: (input: { id: string; trusted: boolean }) =>
      securityApi.trust(input.id, input.trusted),
    onSuccess: async () => {
      await refresh();
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "change that" }));
    },
  });

  const resolved = useMutation({
    mutationFn: (input: { id: string; resolved: boolean }) =>
      securityApi.resolve(input.id, input.resolved),
    onSuccess: async () => {
      await refresh();
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "change that" }));
    },
  });

  usePageCommands("security", [
    {
      id: "security.sign-out-others",
      label: "Sign out every other device",
      keywords: "security session sign out revoke devices password stolen",
      run: () => sweptOthers.mutate(),
    },
    {
      id: "security.failures",
      label: "Show the failed sign-ins",
      keywords: "security failed sign in attempts password",
      run: () => setSignInFilter("FAILURE"),
    },
  ]);

  const sessionColumns: ColumnsType<SignInSession> = [
    {
      title: "Device",
      dataIndex: "device",
      render: (value: string, row) => (
        <div className="nu-sec-device">
          <Space size={6}>
            <Text strong>{value}</Text>
            {row.current ? (
              <Tag color="success" bordered={false}>
                This device
              </Tag>
            ) : null}
          </Space>
          <Text type="secondary" className="nu-sec-agent">
            {row.user_agent ?? "No user agent recorded"}
          </Text>
        </div>
      ),
    },
    {
      title: "Where from",
      dataIndex: "ip_address",
      width: 190,
      render: (value: string | null, row) => (
        <div className="nu-sec-where">
          <Text className="nu-sec-ip">{value ?? "—"}</Text>
          <Text type="secondary">{row.location ?? "Location unknown"}</Text>
        </div>
      ),
    },
    {
      title: "State",
      dataIndex: "state",
      width: 240,
      render: (_value, row) => (
        <Space size={6} className="nu-sec-state">
          <Tag color={sessionTone(row)} bordered={false}>
            {STATE_LABELS[row.state]}
          </Tag>
          <Text type="secondary">{sessionSituation(row)}</Text>
        </Space>
      ),
    },
    {
      title: "Last seen",
      dataIndex: "last_seen_at",
      width: 110,
      render: (value: string | null) => (
        <Tooltip title={absoluteTime(value)}>
          <span>{relativeTime(value)}</span>
        </Tooltip>
      ),
    },
    {
      title: "Recognised",
      dataIndex: "trusted",
      width: 110,
      align: "center",
      render: (value: boolean, row) => (
        <Tooltip
          // Said plainly: a page implying that "trusted" grants something
          // would be claiming a control the platform does not have.
          title="A note to yourself. Nothing on the platform treats a recognised device differently — it is here so the one you do not recognise stands out."
        >
          <Switch
            size="small"
            checked={value}
            disabled={row.state !== "ACTIVE" || trusted.isPending}
            aria-label={`Recognise ${row.device}`}
            data-testid={`trust-${row.id}`}
            onChange={(next) => trusted.mutate({ id: row.id, trusted: next })}
          />
        </Tooltip>
      ),
    },
    {
      title: "",
      width: 130,
      align: "right",
      render: (_value, row) =>
        row.can_revoke ? (
          <Popconfirm
            // A different question for your own session, because pressing
            // "revoke" down a list and landing on your own row is how
            // somebody loses their work.
            title={row.current ? "Sign this device out?" : `Sign ${row.device} out?`}
            description={
              row.current
                ? "You will be signed out here and sent back to the sign-in page."
                : "That device is signed out on its next request, even though its token has not expired."
            }
            okText={row.current ? "Sign me out" : "Sign it out"}
            cancelText="Leave it"
            onConfirm={() => revoked.mutate(row.id)}
          >
            <Button size="small" data-testid={`revoke-${row.id}`} danger={row.current}>
              {row.current ? "Sign me out" : "Sign out"}
            </Button>
          </Popconfirm>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ];

  const signInColumns: ColumnsType<SignIn> = [
    {
      title: "Result",
      dataIndex: "result",
      width: 200,
      render: (value: string, row) => (
        <Space size={6}>
          <Tag color={value === "SUCCESS" ? undefined : "error"} bordered={false}>
            {value === "SUCCESS" ? "Signed in" : "Failed"}
          </Tag>
          {/* Why it failed, which is the difference between a typo and
              somebody trying your password. */}
          {row.reason ? <Text type="danger">{row.reason}</Text> : null}
        </Space>
      ),
    },
    { title: "Method", dataIndex: "method", width: 100 },
    { title: "Device", dataIndex: "device", width: 120 },
    {
      title: "Where from",
      dataIndex: "ip_address",
      width: 190,
      render: (value: string | null, row) => (
        <div className="nu-sec-where">
          <Text className="nu-sec-ip">{value ?? "—"}</Text>
          <Text type="secondary">{row.location ?? "Location unknown"}</Text>
        </div>
      ),
    },
    {
      title: "When",
      dataIndex: "at",
      width: 110,
      render: (value: string | null) => (
        <Tooltip title={absoluteTime(value)}>
          <span>{relativeTime(value)}</span>
        </Tooltip>
      ),
    },
  ];

  const eventColumns: ColumnsType<SecurityEvent> = [
    {
      title: "What happened",
      dataIndex: "title",
      render: (value: string, row) => (
        <div className="nu-sec-event">
          <Space size={6}>
            <Tag color={severityTone(row.severity)} bordered={false}>
              {row.severity.toLowerCase()}
            </Tag>
            <Text strong={!row.resolved}>{value}</Text>
          </Space>
          {row.description ? (
            <Text type="secondary" className="nu-sec-detail">
              {row.description}
            </Text>
          ) : null}
        </div>
      ),
    },
    {
      title: "Where from",
      dataIndex: "ip_address",
      width: 150,
      render: (value: string | null) => <Text className="nu-sec-ip">{value ?? "—"}</Text>,
    },
    {
      title: "When",
      dataIndex: "at",
      width: 110,
      render: (value: string | null) => (
        <Tooltip title={absoluteTime(value)}>
          <span>{relativeTime(value)}</span>
        </Tooltip>
      ),
    },
    {
      title: "Looked at",
      dataIndex: "resolved",
      width: 110,
      align: "center",
      render: (value: boolean, row) => (
        <Switch
          size="small"
          checked={value}
          disabled={resolved.isPending}
          aria-label={`Mark ${row.title} as looked at`}
          data-testid={`resolve-${row.id}`}
          onChange={(next) => resolved.mutate({ id: row.id, resolved: next })}
        />
      ),
    },
  ];

  if (overview.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  return (
    <div className="nu-sec">
      <PageHeader
        title="Security"
        subtitle="Where your account is signed in, who has tried to, and anything the platform has noticed."
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
              Refresh
            </Button>
            <Popconfirm
              title="Sign out every other device?"
              description="Every other session is signed out on its next request. This one stays, so you can see the result."
              okText="Sign the others out"
              cancelText="Leave them"
              onConfirm={() => sweptOthers.mutate()}
            >
              <Button
                danger
                data-testid="revoke-others"
                loading={sweptOthers.isPending}
                disabled={!sessions.data?.others}
              >
                {sessions.data?.others
                  ? `Sign out ${formatNumber(sessions.data.others)} other ${
                      sessions.data.others === 1 ? "device" : "devices"
                    }`
                  : "Nowhere else signed in"}
              </Button>
            </Popconfirm>
          </Space>
        }
      />

      {overview.data ? (
        <Alert
          type={headlineTone(overview.data)}
          showIcon
          className="nu-sec-headline"
          data-testid="security-headline"
          message={headline(overview.data)}
          description={
            overview.data.last_signed_in_at ? (
              <span data-testid="last-sign-in">
                Last signed in {relativeTime(overview.data.last_signed_in_at)} on{" "}
                {overview.data.last_signed_in_on} from{" "}
                {overview.data.last_signed_in_from ?? "an unrecorded address"}.
              </span>
            ) : undefined
          }
        />
      ) : null}

      <Card
        size="small"
        title="Where you are signed in"
        className="nu-sec-card"
        data-testid="sessions-card"
      >
        {sessions.isLoading ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : (
          <>
            {sessions.data && !sessions.data.current_known ? (
              <Alert
                type="info"
                showIcon
                className="nu-sec-note"
                data-testid="no-current"
                message="This request carried no session, so none of these is marked as the one you are using."
                description="That happens with a machine credential rather than a browser sign-in."
              />
            ) : null}
            <Table<SignInSession>
              data-testid="sessions-table"
              rowKey="id"
              size="small"
              dataSource={sessions.data?.items ?? []}
              columns={sessionColumns}
              pagination={false}
              rowClassName={(row) => (row.current ? "nu-sec-row is-current" : "")}
              locale={{
                emptyText: (
                  <Empty image={null} description="No sign-ins recorded on this account yet." />
                ),
              }}
            />
          </>
        )}
      </Card>

      <Card
        size="small"
        title="Sign-in history"
        className="nu-sec-card"
        data-testid="sign-ins-card"
        extra={
          <Segmented
            size="small"
            value={signInFilter}
            onChange={(value) => setSignInFilter(value as "all" | "FAILURE")}
            options={[
              { label: "Everything", value: "all" },
              // Its own filter, because a failure is what somebody opens this
              // page to look for.
              { label: "Failures only", value: "FAILURE" },
            ]}
          />
        }
      >
        {signIns.isLoading ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : (
          <>
            <Table<SignIn>
              data-testid="sign-ins-table"
              rowKey="id"
              size="small"
              dataSource={signIns.data?.items ?? []}
              columns={signInColumns}
              pagination={false}
              rowClassName={(row) => (row.result === "SUCCESS" ? "" : "nu-sec-row is-failure")}
              locale={{
                emptyText: (
                  <Empty
                    image={null}
                    description={
                      signInFilter === "FAILURE"
                        ? "No failed sign-ins. That is the answer you want."
                        : "No sign-ins recorded in this window."
                    }
                  />
                ),
              }}
            />
            {signIns.data ? (
              <Paragraph type="secondary" className="nu-sec-window" data-testid="sign-in-window">
                {formatNumber(signIns.data.total)}{" "}
                {signIns.data.total === 1 ? "sign-in" : "sign-ins"} in the last{" "}
                {signIns.data.window_days} days. Nothing here is ever deleted.
              </Paragraph>
            ) : null}
          </>
        )}
      </Card>

      <Card
        size="small"
        title="What the platform noticed"
        className="nu-sec-card"
        data-testid="events-card"
      >
        {events.isLoading ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : (
          <Table<SecurityEvent>
            data-testid="events-table"
            rowKey="id"
            size="small"
            dataSource={events.data?.items ?? []}
            columns={eventColumns}
            pagination={false}
            rowClassName={(row) => (row.resolved ? "nu-sec-row is-resolved" : "")}
            locale={{
              emptyText: (
                <Empty
                  image={null}
                  description="Nothing noticed on this account. New devices, changed passwords and unusual sign-ins would appear here."
                />
              ),
            }}
          />
        )}
      </Card>
    </div>
  );
}
