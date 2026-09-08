/**
 * `/admin/integrations` — what this platform talks to (§26).
 *
 * Five decisions worth stating.
 *
 * **The rows that need somebody come first, and are counted at the top.**
 * Twelve providers of which three are broken is a page whose whole value is
 * telling you which three. Everything else is a directory.
 *
 * **"Switched on" and "working" are two facts, shown as two.** An integration
 * somebody enabled that is now failing is the row this screen exists for, and
 * collapsing intent and outcome into one badge would hide it — the reader would
 * see "error" and not know whether anybody expects it to be running.
 *
 * **A check reports what it checked.** The button says "Check settings", not
 * "Test connection", and the result says in words that the provider was not
 * contacted. A green tick claiming a connection nothing attempted would be the
 * worst possible lie on this screen, and the note points at the one function to
 * replace to make it real.
 *
 * **A secret shows as set, never shown.** The server sends a redaction and the
 * field offers a replacement — and sending the redaction back means "leave it
 * alone", so a save of some other field cannot overwrite a token with bullets.
 *
 * **There is no "add integration".** The providers come with the code; an
 * operator extends the list by deploying, not by typing a name. A button that
 * implied otherwise would be a promise the platform cannot keep (§76).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Segmented,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { CheckCircleOutlined, LinkOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  integrationsApi,
  type Integration,
  type IntegrationDetail,
  type IntegrationState,
} from "@/api/integrations";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { asText } from "@/lib/text";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text, Paragraph } = Typography;

/**
 * The tone a state earns.
 *
 * NOT_CONFIGURED is deliberately neutral rather than a warning: nobody has
 * finished setting it up, which is not a fault — treating it as one would put
 * eight untouched providers in the same colour as the two that are actually
 * broken (§64).
 */
export function stateTone(state: IntegrationState): string | undefined {
  switch (state) {
    case "CONNECTED":
      return "success";
    case "ERROR":
      return "error";
    case "DISCONNECTED":
      return "default";
    default:
      return undefined;
  }
}

/**
 * What an integration's two facts come to, in one sentence.
 *
 * Exported and asserted directly, because this is where intent and outcome
 * meet and a single word would lose one of them. "Error" alone does not say
 * whether anybody expects it to be running; "switched on and failing" does,
 * and that is the row somebody has to act on.
 */
export function situation(row: Integration): string {
  if (!row.configured) {
    const count = row.missing_settings.length;
    return `Needs ${row.missing_settings.join(" and ")} — ${count === 1 ? "one setting" : `${count} settings`} away from usable`;
  }
  if (row.enabled && row.state === "ERROR") return "Switched on and failing";
  if (row.enabled && row.state === "CONNECTED") return "On, and working";
  if (row.enabled) return "Switched on, not connected yet";
  if (row.state === "ERROR") return "Off, and it was failing when it stopped";
  return "Configured, switched off";
}

export default function IntegrationsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const [box, setBox] = useState(params.get("q") ?? "");
  const term = useDebouncedValue(box, 250);
  const category = params.get("category") ?? "";
  const opened = params.get("integration");

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
    queryKey: ["integrations", "catalogue"],
    queryFn: ({ signal }) => integrationsApi.catalogue(signal),
    staleTime: 30_000,
  });

  const listing = useQuery({
    queryKey: ["integrations", "list", term, category],
    queryFn: ({ signal }) =>
      integrationsApi.list(
        { ...(term ? { q: term } : {}), ...(category ? { category } : {}), page_size: 100 },
        signal,
      ),
  });

  const detail = useQuery({
    queryKey: ["integrations", "entry", opened],
    queryFn: ({ signal }) => integrationsApi.entry(opened!, signal),
    enabled: opened !== null,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["integrations"] });
  };

  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : "That was refused.");

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      integrationsApi.setEnabled(id, enabled),
    onSuccess: async (row) => {
      message.success(`${row.name} is ${row.enabled ? "on" : "off"}.`);
      await refresh();
    },
    // The server's sentence, which names the missing settings.
    onError: failed,
  });

  const check = useMutation({
    mutationFn: (id: string) => integrationsApi.check(id),
    onSuccess: async (result) => {
      // Success and failure both say what was established, because "checked"
      // on its own tells nobody whether they can stop worrying.
      if (result.configured) {
        message.success(`${result.name}: every required setting is present.`);
      } else {
        message.warning(`${result.name}: ${result.missing_settings.join(", ")} still missing.`);
      }
      await refresh();
    },
    onError: failed,
  });

  const configure = useMutation({
    mutationFn: ({ id, configuration }: { id: string; configuration: Record<string, unknown> }) =>
      integrationsApi.configure(id, configuration),
    onSuccess: async (row) => {
      message.success(
        row.configured
          ? `${row.name} has everything it needs.`
          : `Saved. ${row.name} still needs ${row.missing_settings.join(", ")}.`,
      );
      await refresh();
    },
    onError: failed,
  });

  usePageCommands("admin-integrations", [
    {
      id: "integrations.attention",
      label: "Show the integrations that need attention",
      keywords: "integrations broken failing error connected",
      run: () => set({ category: null, q: null }),
    },
  ]);

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (catalogue.isError) {
    return (
      <>
        <PageHeader title="Integrations" />
        <Alert
          type="error"
          showIcon
          message={
            catalogue.error instanceof ApiError
              ? catalogue.error.message
              : "The integrations could not be read."
          }
        />
      </>
    );
  }

  const { categories, states, needing_attention: attention, redacted } = catalogue.data!;
  // Sorted so the rows somebody has to act on are the ones they see first:
  // switched on and not working, then broken, then unconfigured, then the rest.
  const rows = [...(listing.data?.items ?? [])].sort((left, right) => {
    const rank = (row: Integration) =>
      row.enabled && row.state !== "CONNECTED" ? 0 : row.state === "ERROR" ? 1 : !row.configured ? 2 : 3;
    return rank(left) - rank(right) || left.name.localeCompare(right.name);
  });

  const columns: ColumnsType<Integration> = [
    {
      title: "Integration",
      dataIndex: "name",
      render: (name: string, row) => (
        // A per-row handle: several providers share a name with their own
        // product ("Slack" by Slack), so locating a row by its text is
        // ambiguous by construction.
        <div className="nu-int-what" data-testid={`int-${row.key}`}>
          <Space size={6}>
            <Text strong>{name}</Text>
            <Text type="secondary" className="nu-int-provider">
              {row.provider}
            </Text>
          </Space>
          <Text type="secondary" className="nu-int-category">
            {row.category.replace(/_/g, " ").toLowerCase()}
          </Text>
        </div>
      ),
    },
    {
      title: "Where it stands",
      dataIndex: "state",
      width: 320,
      render: (state: IntegrationState, row) => (
        <Space size={6}>
          {/* Written out as well as coloured (§64). */}
          <Tag color={stateTone(state)} bordered={false}>
            {state.replace(/_/g, " ").toLowerCase()}
          </Tag>
          <Text
            type={row.enabled && state !== "CONNECTED" ? "warning" : "secondary"}
            className="nu-int-situation"
          >
            {situation(row)}
          </Text>
        </Space>
      ),
    },
    {
      title: "On",
      dataIndex: "enabled",
      width: 76,
      render: (enabled: boolean, row) => (
        <Tooltip
          title={
            row.configured
              ? enabled
                ? `Turn ${row.name} off`
                : `Turn ${row.name} on`
              : `${row.name} needs ${row.missing_settings.join(", ")} first`
          }
        >
          <Switch
            size="small"
            checked={enabled}
            // Disabled with the reason rather than hidden: turning it on *is*
            // what somebody came to do, and the settings are the actionable
            // part (§76).
            disabled={!row.configured || toggle.isPending}
            aria-label={`${enabled ? "Turn off" : "Turn on"} ${row.name}`}
            data-testid={`toggle-${row.key}`}
            onChange={(next) => toggle.mutate({ id: row.id, enabled: next })}
            onClick={(_checked, event) => event.stopPropagation()}
          />
        </Tooltip>
      ),
    },
    {
      title: "Last connected",
      dataIndex: "last_connected_at",
      width: 132,
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
        title="Integrations"
        subtitle="What this platform talks to, what each one needs, and whether it is working."
        tag={
          attention > 0 ? (
            <Tag color="warning">{attention} need attention</Tag>
          ) : (
            <Tag>nothing broken</Tag>
          )
        }
        actions={
          <Space size={8}>
            <Input.Search
              allowClear
              placeholder="Name or provider"
              aria-label="Search integrations"
              style={{ width: 220 }}
              value={box}
              onChange={(event) => setBox(event.target.value)}
            />
            <Tooltip title="Read it again">
              <Button
                icon={<ReloadOutlined />}
                aria-label="Refresh the integrations"
                loading={listing.isFetching}
                onClick={() => void listing.refetch()}
              />
            </Tooltip>
          </Space>
        }
      />

      {/* The reason to open this page, said first. */}
      {attention > 0 && (
        <Alert
          className="nu-block"
          type="warning"
          showIcon
          data-testid="attention"
          message={`${attention} ${attention === 1 ? "integration is" : "integrations are"} switched on and not connected`}
          description="They are at the top of the list. Everything below them is either working or switched off."
        />
      )}

      <Card size="small" className="nu-filter-bar">
        <Space wrap size={8} align="center">
          <Segmented
            aria-label="Category"
            value={category || "all"}
            onChange={(next) => set({ category: next === "all" ? null : String(next) })}
            options={[
              { value: "all", label: `All (${catalogue.data!.total})` },
              ...categories
                .filter((item) => item.count > 0)
                .map((item) => ({
                  value: item.key,
                  label: `${item.key.replace(/_/g, " ").toLowerCase()} (${item.count})`,
                })),
            ]}
          />
          <Text type="secondary" className="nu-int-tally" data-testid="state-tally">
            {states
              .filter((item) => item.count > 0)
              .map((item) => `${item.count} ${item.key.replace(/_/g, " ").toLowerCase()}`)
              .join(" · ")}
          </Text>
        </Space>
      </Card>

      <div className="nu-pane nu-pane--table">
        <Table<Integration>
          size="small"
          rowKey="id"
          data-testid="integrations-table"
          columns={columns}
          dataSource={rows}
          loading={listing.isLoading}
          onRow={(row) => ({
            onClick: () => set({ integration: row.id }),
            style: { cursor: "pointer" },
          })}
          rowClassName={(row) =>
            row.enabled && row.state !== "CONNECTED" ? "nu-int-row is-attention" : "nu-int-row"
          }
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={term || category ? "No integration matches that." : "None configured."}
              />
            ),
          }}
          pagination={false}
        />
      </div>

      <Drawer
        open={opened !== null}
        onClose={() => set({ integration: null })}
        width={620}
        title={detail.data?.name ?? "Integration"}
        destroyOnClose
      >
        {detail.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}
        {detail.isError && (
          <Alert
            type="error"
            showIcon
            message={
              detail.error instanceof ApiError
                ? detail.error.message
                : "That integration could not be read."
            }
          />
        )}
        {detail.data && (
          <IntegrationPanel
            row={detail.data}
            redacted={redacted}
            busy={configure.isPending || check.isPending || toggle.isPending}
            checking={check.isPending}
            lastCheck={check.data?.id === detail.data.id ? check.data : null}
            onCheck={() => check.mutate(detail.data.id)}
            onSave={(configuration) =>
              configure.mutate({ id: detail.data.id, configuration })
            }
          />
        )}
      </Drawer>
    </div>
  );
}

/** One integration: what it needs, what it has, and what a check established. */
function IntegrationPanel({
  row,
  redacted,
  busy,
  checking,
  lastCheck,
  onCheck,
  onSave,
}: {
  row: IntegrationDetail;
  redacted: string;
  busy: boolean;
  checking: boolean;
  lastCheck: { configured: boolean; note: string; reached_provider: false } | null;
  onCheck: () => void;
  onSave: (configuration: Record<string, unknown>) => void;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const settings = [
    ...row.required_settings,
    ...Object.keys(row.configuration).filter((name) => !row.required_settings.includes(name)),
  ];
  const dirty = Object.keys(edits).length > 0;

  return (
    <Space direction="vertical" size={16} className="nu-block">
      <div>
        <Space size={8}>
          <Tag color={stateTone(row.state)} bordered={false}>
            {row.state.replace(/_/g, " ").toLowerCase()}
          </Tag>
          <Tag bordered={false}>{row.enabled ? "switched on" : "switched off"}</Tag>
        </Space>
        <Paragraph className="nu-int-situation-detail">{situation(row)}</Paragraph>
        {row.description && <Text type="secondary">{row.description}</Text>}
      </div>

      {row.last_error && (
        <Alert
          type={row.enabled ? "error" : "warning"}
          showIcon
          data-testid="int-error"
          message={row.enabled ? "It is failing" : "It was failing when it stopped"}
          description={
            <>
              {row.last_error}
              {row.last_error_at && (
                <Text type="secondary"> · {relativeTime(row.last_error_at)}</Text>
              )}
            </>
          }
        />
      )}

      <section data-testid="int-settings">
        <Text strong>Settings</Text>
        <p>
          <Text type="secondary">
            A secret is held in your deployment&apos;s own store and referenced here by name —
            never pasted in.
          </Text>
        </p>

        <div className="nu-int-fields">
          {settings.map((name) => {
            const isRedacted = row.redacted_settings.includes(name);
            const required = row.required_settings.includes(name);
            const absent = row.missing_settings.includes(name);
            return (
              <label key={name} className="nu-int-field">
                <span className="nu-int-field-name">
                  {name}
                  {required && <Text type="secondary"> · required</Text>}
                  {absent && <Text type="warning"> · not set</Text>}
                </span>
                <Input
                  aria-label={`${name} for ${row.name}`}
                  data-testid={`setting-${name}`}
                  value={edits[name] ?? (isRedacted ? "" : asText(row.configuration[name]))}
                  // A redacted field asks for a replacement rather than
                  // showing what is there — and leaving it blank changes
                  // nothing, because the page never sends the redaction.
                  placeholder={isRedacted ? "Set — type to replace" : absent ? "Not set" : ""}
                  disabled={busy}
                  onChange={(event) =>
                    setEdits((current) => ({ ...current, [name]: event.target.value }))
                  }
                />
              </label>
            );
          })}
        </div>

        <Space size={8} className="nu-block">
          <Button
            type="primary"
            disabled={!dirty || busy}
            onClick={() => {
              onSave(edits);
              setEdits({});
            }}
            data-testid="save-settings"
          >
            Save settings
          </Button>
          <Tooltip title="Checks that every required setting is present. It does not contact the provider.">
            <Button
              icon={<CheckCircleOutlined />}
              loading={checking}
              disabled={busy && !checking}
              onClick={onCheck}
              data-testid="check-settings"
            >
              Check settings
            </Button>
          </Tooltip>
          {row.docs_url && (
            <Button
              type="link"
              icon={<LinkOutlined />}
              href={row.docs_url}
              target="_blank"
              rel="noreferrer"
            >
              How to set this up
            </Button>
          )}
        </Space>

        {lastCheck && (
          <Alert
            className="nu-block"
            type={lastCheck.configured ? "success" : "warning"}
            showIcon
            data-testid="check-result"
            message={
              lastCheck.configured ? "Every required setting is present" : "Something is missing"
            }
            // The note says the provider was not contacted. A green tick
            // claiming a connection nothing attempted would be the worst lie
            // available on this screen.
            description={lastCheck.note}
          />
        )}
        {redacted && <span hidden data-testid="redaction">{redacted}</span>}
      </section>
    </Space>
  );
}
