/**
 * `/admin/api` — the machines that call this platform (§25).
 *
 * Five decisions worth stating.
 *
 * **The secret is shown once, and the page is built around that being true.**
 * It arrives on exactly one response, so it is put somewhere it cannot be
 * dismissed by accident: a modal that says plainly this is the only time, with
 * a copy button, and a confirmation before it closes. Not a toast — a toast
 * that scrolls away takes the key with it, and the only recovery is minting
 * another and redeploying whatever holds the old one.
 *
 * **Only the scopes this caller may grant are offered.** The server sends its
 * own list; a form offering the whole catalogue and refusing half of it on save
 * would be a form that produces an error on purpose. What is withheld is
 * *counted* rather than hidden silently, so somebody who cannot find a
 * permission knows why.
 *
 * **Rotation is presented as what it is: two live keys and a deadline.** The
 * old key's expiry is on the screen next to the new one, because the whole
 * point of the grace period is that somebody has to redeploy before it passes.
 *
 * **A revoked key stays on the list.** Greyed, dated, and named — the question
 * after a leak is always when and by whom, and a row that vanished answers
 * neither (§34).
 *
 * **The lifetime counter and the recent window are labelled apart.** Three
 * point seven million requests beside twelve logged rows is two different
 * questions, and putting them together unlabelled would read as one answer
 * that happens to be wrong (§71).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined, RetweetOutlined, StopOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  apiClientsApi,
  type ApiClientDetail,
  type ApiClientRow,
  type Credential,
  type CredentialState,
  type Minted,
} from "@/api/apiClients";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { absoluteTime, relativeTime } from "@/lib/time";
import { formatNumber } from "@/lib/formats";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

const { Text, Paragraph } = Typography;

/**
 * The tone a credential's state earns.
 *
 * EXPIRED is a warning and not an error: a key that ran out is usually a
 * rotation nobody finished, which needs somebody's attention rather than an
 * alarm. REVOKED is neither — it is a decision somebody made, and colouring it
 * red would put every deliberate act on the same footing as a fault (§64).
 */
export function stateTone(state: CredentialState): string | undefined {
  switch (state) {
    case "ACTIVE":
      return "success";
    case "EXPIRED":
      return "warning";
    default:
      return undefined;
  }
}

/**
 * What a credential's dates come to, in words.
 *
 * Exported and asserted directly because a date on its own is not an answer:
 * "expires 2026-09-15" needs the reader to know today's date and do the
 * subtraction, and the thing they actually want to know is whether there is
 * time to redeploy.
 */
export function credentialStory(credential: Credential, now = new Date()): string {
  if (credential.state === "REVOKED") {
    return credential.revoked_at
      ? `Revoked ${relativeTime(credential.revoked_at)}`
      : "Revoked";
  }
  if (credential.expires_at === null) {
    return credential.last_used_at
      ? `Last used ${relativeTime(credential.last_used_at)}`
      : "Never used";
  }
  const expires = new Date(credential.expires_at);
  if (credential.state === "EXPIRED") {
    return `Expired ${relativeTime(credential.expires_at)}`;
  }
  const days = Math.ceil((expires.getTime() - now.getTime()) / 86_400_000);
  return days <= 1 ? "Expires today — redeploy now" : `Expires in ${days} days`;
}

export default function ApiClientsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const [box, setBox] = useState(params.get("q") ?? "");
  const term = useDebouncedValue(box, 250);
  const opened = params.get("client");
  const [creating, setCreating] = useState(false);
  // The one piece of state that must not be lost: a minted secret exists
  // nowhere else.
  const [minted, setMinted] = useState<(Minted & { about: string }) | null>(null);
  const [form] = Form.useForm();
  const { touch, settled, requestClose } = useDiscardGuard({
    close: () => setCreating(false),
    what: "client",
  });

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
    queryKey: ["api-clients", "catalogue"],
    queryFn: ({ signal }) => apiClientsApi.catalogue(signal),
    staleTime: 60_000,
  });

  const listing = useQuery({
    queryKey: ["api-clients", "list", term],
    queryFn: ({ signal }) =>
      apiClientsApi.list({ ...(term ? { q: term } : {}), page_size: 100 }, signal),
  });

  const detail = useQuery({
    queryKey: ["api-clients", "entry", opened],
    queryFn: ({ signal }) => apiClientsApi.entry(opened!, signal),
    enabled: opened !== null,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["api-clients"] });
  };

  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : "That was refused.");

  const create = useMutation({
    mutationFn: (body: { name: string; scopes?: string[] }) => apiClientsApi.create(body),
    onSuccess: async (made) => {
      settled();
      setCreating(false);
      form.resetFields();
      // Straight into the modal, before anything else can take the focus.
      setMinted({ ...made, about: made.name });
      // And open the client *before* awaiting the refetch. After the await the
      // navigation was being lost, so the page stayed on the list — which
      // meant somebody who had just minted a key landed nowhere useful.
      set({ client: made.id });
      await refresh();
    },
    onError: failed,
  });

  const rotate = useMutation({
    mutationFn: ({ id, credentialId }: { id: string; credentialId?: string }) =>
      apiClientsApi.rotate(id, credentialId ? { credential_id: credentialId } : {}),
    onSuccess: async (result) => {
      setMinted({ ...result, about: detail.data?.name ?? "this client" });
      await refresh();
    },
    onError: failed,
  });

  const revoke = useMutation({
    mutationFn: (credentialId: string) => apiClientsApi.revoke(credentialId),
    onSuccess: async (credential) => {
      message.success(`${credential.prefix}… is revoked. Anything using it will fail now.`);
      await refresh();
    },
    onError: failed,
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClientsApi.remove(id),
    onSuccess: async (result) => {
      message.success(
        result.credentials_revoked > 0
          ? `${result.name} retired, and ${result.credentials_revoked} live ${result.credentials_revoked === 1 ? "key" : "keys"} revoked.`
          : `${result.name} retired.`,
      );
      set({ client: null });
      await refresh();
    },
    onError: failed,
  });

  usePageCommands("admin-api", [
    {
      id: "api.new",
      label: "Register an API client",
      keywords: "api client credential key token scope",
      run: () => setCreating(true),
    },
  ]);

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (catalogue.isError) {
    return (
      <>
        <PageHeader title="API clients" />
        <Alert
          type="error"
          showIcon
          message={
            catalogue.error instanceof ApiError
              ? catalogue.error.message
              : "The API clients could not be read."
          }
        />
      </>
    );
  }

  const { scopes, withheld_scopes: withheld, rotation_grace_days: grace } = catalogue.data!;
  const rows = listing.data?.items ?? [];

  const columns: ColumnsType<ApiClientRow> = [
    {
      title: "Client",
      dataIndex: "name",
      render: (name: string, row) => (
        <div className="nu-api-what">
          <Space size={6}>
            <Text strong>{name}</Text>
            <Tag
              bordered={false}
              color={row.status === "ACTIVE" ? "success" : row.status === "SUSPENDED" ? "warning" : undefined}
            >
              {row.status.toLowerCase()}
            </Tag>
          </Space>
          <Text type="secondary" className="nu-api-id">
            {row.client_id}
          </Text>
        </div>
      ),
    },
    {
      title: "Keys",
      dataIndex: "live_credentials",
      width: 108,
      render: (live: number, row) => (
        <Text type={live === 0 ? "warning" : undefined}>
          {/* A client with no live key cannot call at all, which is worth
              saying rather than showing as "0 of 3". */}
          {live === 0 ? "none live" : `${live} of ${row.credential_count}`}
        </Text>
      ),
    },
    {
      title: "Scopes",
      dataIndex: "scopes",
      width: 260,
      render: (values: string[]) => (
        <Text type={values.length === 0 ? "secondary" : undefined} className="nu-api-scopes">
          {values.length === 0 ? "none" : values.join(", ")}
        </Text>
      ),
    },
    {
      title: "Requests",
      dataIndex: "requests_total",
      width: 132,
      align: "right",
      render: (total: number, row) => (
        <Tooltip title="Lifetime, counted by the gateway — not the request log below.">
          <Text type="secondary" className="nu-api-count">
            {formatNumber(total)}
            {row.error_rate > 0 && (
              <>
                <br />
                {(row.error_rate * 100).toFixed(1)}% errors
              </>
            )}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: "Last used",
      dataIndex: "last_used_at",
      width: 130,
      render: (value: string | null) =>
        value ? (
          <Tooltip title={absoluteTime(value)}>
            <Text type="secondary">{relativeTime(value)}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">never</Text>
        ),
    },
  ];

  return (
    <div className="nu-fill">
      <PageHeader
        title="API clients"
        subtitle="Machines that call this platform, the keys they call with, and what those keys may do."
        tag={<Tag>{catalogue.data!.total} clients</Tag>}
        actions={
          <Space size={8}>
            <Input.Search
              allowClear
              placeholder="Name or client id"
              aria-label="Search clients"
              style={{ width: 230 }}
              value={box}
              onChange={(event) => setBox(event.target.value)}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreating(true)}
              data-testid="new-client"
            >
              Register a client
            </Button>
          </Space>
        }
      />

      <div className="nu-pane nu-pane--table">
        <Table<ApiClientRow>
          size="small"
          rowKey="id"
          data-testid="clients-table"
          columns={columns}
          dataSource={rows}
          loading={listing.isLoading}
          onRow={(row) => ({
            onClick: () => set({ client: row.id }),
            style: { cursor: "pointer" },
          })}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={term ? "No client matches that." : "No API clients yet."}
              />
            ),
          }}
          pagination={false}
        />
      </div>

      <Drawer
        open={opened !== null}
        onClose={() => set({ client: null })}
        width={700}
        title={detail.data?.name ?? "Client"}
        destroyOnClose
        extra={
          detail.data && (
            <Popconfirm
              title={`Retire ${detail.data.name}?`}
              description={
                detail.data.live_credentials > 0
                  ? `Its ${detail.data.live_credentials} live ${detail.data.live_credentials === 1 ? "key" : "keys"} are revoked with it. Anything using them fails immediately.`
                  : "It has no live keys, so nothing stops working."
              }
              okText="Retire it"
              okButtonProps={{ danger: true }}
              onConfirm={() => remove.mutate(detail.data.id)}
            >
              <Button danger icon={<DeleteOutlined />} loading={remove.isPending} data-testid="retire-client">
                Retire
              </Button>
            </Popconfirm>
          )
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
                : "That client could not be read."
            }
          />
        )}
        {detail.data && (
          <ClientDetail
            client={detail.data}
            grace={grace}
            busy={rotate.isPending || revoke.isPending}
            onRotate={(credentialId) =>
              rotate.mutate({ id: detail.data.id, credentialId })
            }
            onRevoke={(credentialId) => revoke.mutate(credentialId)}
          />
        )}
      </Drawer>

      <Modal
        open={creating}
        onCancel={requestClose}
        title="Register an API client"
        okText="Register it"
        confirmLoading={create.isPending}
        onOk={() => {
          void form
            .validateFields()
            .then((values: { name: string; scopes?: string[] }) => create.mutate(values))
            .catch(() => {
              // The form is already showing why.
            });
        }}
        okButtonProps={{ "data-testid": "create-client" }}
      >
        <Form form={form} layout="vertical" data-testid="client-form" onValuesChange={touch}>
          <Alert
            type="warning"
            showIcon
            className="nu-block"
            message="Its key is shown once"
            description="The platform stores only a hash, so there is no way to see it again. Copy it before you close the box."
          />
          <Form.Item
            name="name"
            label="What is calling"
            rules={[{ required: true, message: "A client needs a name." }]}
          >
            <Input autoFocus maxLength={160} placeholder="Warehouse sync" aria-label="Client name" />
          </Form.Item>
          <Form.Item
            name="scopes"
            label="What it may do"
            extra={
              withheld.length > 0
                ? `${withheld.length} more exist that you cannot grant, because you do not hold them yourself.`
                : "A client cannot be given a permission you do not hold."
            }
          >
            <Select
              mode="multiple"
              aria-label="Scopes"
              placeholder="Nothing — it can authenticate and read nothing"
              optionFilterProp="label"
              options={scopes.map((item) => ({
                value: item.code,
                label: `${item.code} — ${item.label}`,
              }))}
            />
          </Form.Item>
          <Space size={12}>
            <Form.Item name="rate_limit_per_minute" label="Requests a minute">
              <InputNumber min={1} max={100000} placeholder="600" aria-label="Rate limit" />
            </Form.Item>
            <Form.Item name="quota_per_day" label="Requests a day">
              <InputNumber min={1} max={100000000} placeholder="100000" aria-label="Daily quota" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <SecretModal minted={minted} onClose={() => setMinted(null)} grace={grace} />
    </div>
  );
}

/**
 * The one place a secret is ever shown.
 *
 * A modal rather than a toast, and one that asks before it closes: the value
 * exists nowhere else, and the recovery from losing it is minting another and
 * redeploying whatever held the old one. A notification that scrolled away
 * would take the key with it.
 */
function SecretModal({
  minted,
  onClose,
  grace,
}: {
  minted: (Minted & { about: string; replaced?: Credential | null }) | null;
  onClose: () => void;
  grace: number;
}) {
  const { modal } = AntApp.useApp();

  return (
    <Modal
      open={minted !== null}
      title="Copy this key now"
      closable={false}
      maskClosable={false}
      keyboard={false}
      okText="I have copied it"
      onOk={() =>
        modal.confirm({
          title: "Closing this is final",
          content:
            "The key is not stored anywhere in a form that can be read back. If you have not copied it, the only fix is to rotate again.",
          okText: "I have it",
          cancelText: "Wait, let me copy it",
          onOk: onClose,
        })
      }
      cancelButtonProps={{ style: { display: "none" } }}
    >
      {minted && (
        // The test id goes on the *content*, not on the `Modal`: AntD forwards
        // unknown props to a wrapper that exists at zero size even when the
        // dialog is open, so `toBeVisible` on it is always false. One id, one
        // meaning, and it is the thing a reader can actually see.
        <div data-testid="secret-modal">
          <Paragraph>
            <Text strong>{minted.about}</Text> can now call the platform with this key. It is
            shown <Text strong>once</Text> — the platform keeps only a hash of it.
          </Paragraph>
          <Paragraph
            copyable={{ text: minted.secret, tooltips: ["Copy the key", "Copied"] }}
            className="nu-api-secret"
            data-testid="secret-value"
          >
            {minted.secret}
          </Paragraph>
          {minted.replaced && (
            <Alert
              type="info"
              showIcon
              message={`The previous key works for ${grace} more days`}
              description={`${minted.replaced.prefix}… expires ${minted.replaced.expires_at ? absoluteTime(minted.replaced.expires_at) : "soon"}. Redeploy whatever uses it before then.`}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

/** One client: its keys, its limits, and the requests it has recently made. */
function ClientDetail({
  client,
  grace,
  busy,
  onRotate,
  onRevoke,
}: {
  client: ApiClientDetail;
  grace: number;
  busy: boolean;
  onRotate: (credentialId?: string) => void;
  onRevoke: (credentialId: string) => void;
}) {
  return (
    <Space direction="vertical" size={16} className="nu-block">
      {client.live_credentials === 0 && (
        <Alert
          type="warning"
          showIcon
          data-testid="no-live-keys"
          message="This client cannot call anything"
          description="Every key it holds is revoked or expired. Add one to bring it back."
        />
      )}

      <Card size="small" data-testid="client-numbers">
        <div className="nu-api-stats">
          {/* Two windows, labelled — see the module docstring. */}
          <Statistic
            title="Requests (lifetime)"
            value={client.requests_total}
            formatter={(value) => formatNumber(Number(value))}
          />
          <Statistic title="Today" value={client.requests_today} formatter={(v) => formatNumber(Number(v))} />
          <Statistic
            title="Errors (lifetime)"
            value={`${(client.error_rate * 100).toFixed(1)}%`}
          />
          <Statistic
            title="In the log below"
            value={`${client.recent_failures} of ${client.recent_window} failed`}
          />
        </div>
        <Descriptions
          size="small"
          column={2}
          className="nu-block"
          items={[
            { key: "id", label: "Client ID", children: <Text copyable className="nu-mono">{client.client_id}</Text> },
            { key: "rate", label: "Rate limit", children: `${formatNumber(client.rate_limit_per_minute)}/min` },
            { key: "quota", label: "Daily quota", children: formatNumber(client.quota_per_day) },
            {
              key: "ips",
              label: "From",
              children: client.allowed_ips.length > 0 ? client.allowed_ips.join(", ") : "anywhere",
            },
          ]}
        />
      </Card>

      <section data-testid="client-scopes">
        <Text strong>What it may do</Text>
        <div className="nu-block">
          {client.scopes.length === 0 ? (
            <Text type="secondary">
              Nothing. It can authenticate and read nothing — which is a valid state for a
              client that has not been given its scopes yet.
            </Text>
          ) : (
            <Space size={[4, 4]} wrap>
              {client.scopes.map((scope) => (
                <Tag key={scope} bordered={false} className="nu-mono">
                  {scope}
                </Tag>
              ))}
            </Space>
          )}
        </div>
      </section>

      <section data-testid="client-keys">
        <Space size={8} align="center">
          <Text strong>Keys</Text>
          <Button
            size="small"
            icon={<PlusOutlined />}
            disabled={busy}
            onClick={() => onRotate(undefined)}
            data-testid="add-key"
          >
            Add a key
          </Button>
        </Space>

        <ul className="nu-api-keys">
          {client.credentials.map((credential) => (
            <li key={credential.id} data-testid={`key-${credential.prefix}`}>
              <span className="nu-api-key-what">
                <Space size={6}>
                  <Text className="nu-mono">{credential.prefix}…</Text>
                  {/* Written out as well as coloured (§64). */}
                  <Tag color={stateTone(credential.state)} bordered={false}>
                    {credential.state.toLowerCase()}
                  </Tag>
                  {credential.rotated_from_id && (
                    <Tooltip title="Minted by rotating an earlier key">
                      <Tag bordered={false}>rotated</Tag>
                    </Tooltip>
                  )}
                </Space>
                <Text type="secondary" className="nu-api-key-story">
                  {credential.label} · {credentialStory(credential)}
                </Text>
              </span>

              {credential.state === "ACTIVE" && (
                <Space size={2}>
                  <Popconfirm
                    title={`Rotate ${credential.prefix}…?`}
                    description={`A new key is minted now and this one keeps working for ${grace} days, so you can redeploy before it stops.`}
                    okText="Rotate"
                    onConfirm={() => onRotate(credential.id)}
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<RetweetOutlined />}
                      disabled={busy}
                      aria-label={`Rotate ${credential.prefix}`}
                      data-testid={`rotate-${credential.prefix}`}
                    />
                  </Popconfirm>
                  <Popconfirm
                    title={`Revoke ${credential.prefix}… now?`}
                    description="Anything using it fails immediately. There is no grace period — that is what rotation is for."
                    okText="Revoke it"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => onRevoke(credential.id)}
                  >
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<StopOutlined />}
                      disabled={busy}
                      aria-label={`Revoke ${credential.prefix}`}
                      data-testid={`revoke-${credential.prefix}`}
                    />
                  </Popconfirm>
                </Space>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="client-requests">
        <Text strong>
          Recent requests{" "}
          <Text type="secondary">(the last {client.recent_window}, not the lifetime total)</Text>
        </Text>
        {client.recent_requests.length === 0 ? (
          <p>
            <Text type="secondary">Nothing logged for this client yet.</Text>
          </p>
        ) : (
          <ul className="nu-api-requests">
            {client.recent_requests.map((request) => (
              <li key={request.id}>
                <Text
                  type={request.status_code >= 400 ? "danger" : "secondary"}
                  className="nu-api-request-status"
                >
                  {request.status_code}
                </Text>
                <Text className="nu-api-request-path">
                  {request.method} {request.path}
                </Text>
                <Text type="secondary" className="nu-api-request-when">
                  {request.requested_at ? relativeTime(request.requested_at) : "—"}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Space>
  );
}
