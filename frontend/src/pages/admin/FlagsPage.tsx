/**
 * `/admin/flags` — feature flags (§27, §20).
 *
 * Every flag here is *real*: the server's catalogue says what each one gates —
 * routes, menu entries, API endpoints, background jobs, live messages and the
 * components inside other pages — and the API refuses a switched-off feature
 * with `feature_disabled`. This screen is where that is decided, so it says
 * exactly what a switch will do before it is flipped.
 *
 * Five decisions worth stating.
 *
 * **Grouped by where the feature lives.** Fifty-odd flags in one table is a
 * list nobody can scan; grouped by the product's own areas (Overview, AI,
 * Work…) it reads like the navigation it controls. Search narrows across all.
 *
 * **Turning something off is confirmed, with the blast radius.** The dialog
 * lists the routes that will show "switched off", the menu entries and
 * components that disappear, the endpoints that will refuse, and the flags
 * that go with it. Turning one *on* restores what it guards and needs no
 * ceremony.
 *
 * **Every row answers "and do *I* have it?"** — computed by the server with
 * the same rule it gates with — and "preview as" answers it for any role.
 *
 * **Rollout and targeting live in a drawer** (people, roles, groups,
 * organizations, a percentage), beside what the flag controls and its audit
 * history: who changed it, when, from what to what.
 *
 * **Deleting is refused while it is on**, by the server, and the page says
 * why before it is tried.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Skeleton,
  Slider,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, EyeOutlined, PlusOutlined, SettingOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { groupsApi } from "@/api/groups";
import { metaApi } from "@/api/meta";
import { organizationsApi } from "@/api/organizations";
import { settingsApi, type FeatureFlag, type FlagControls } from "@/api/settings";
import { URL_OVERLAY } from "@/app/history";
import { useUrlOverlay } from "@/app/useUrlOverlay";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { absoluteTime, relativeTime } from "@/lib/time";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { EmptyState } from "@/components/EmptyState";
import { usePhoneList } from "@/pages/admin/ResponsiveTable";
import "@/styles/flags.css";

const { Text } = Typography;

/**
 * What a flag's reach adds up to, in words.
 *
 * Pure and exported. This is the sentence the page exists to say: off, on for
 * everybody, on for a named set, and on for a share of people. "50%" on its
 * own is the one answer that leaves a reader guessing.
 */
export function reachOf(flag: FeatureFlag): string {
  if (!flag.enabled) return "Off for everybody";
  const named: string[] = [];
  if (flag.target_roles.length > 0) named.push(flag.target_roles.join(", "));
  if (flag.target_user_ids.length > 0) {
    named.push(
      `${flag.target_user_ids.length} named ${flag.target_user_ids.length === 1 ? "person" : "people"}`,
    );
  }
  const groups = flag.target_group_ids?.length ?? 0;
  if (groups > 0) named.push(`${groups} ${groups === 1 ? "group" : "groups"}`);
  const orgs = flag.target_organization_ids?.length ?? 0;
  if (orgs > 0) named.push(`${orgs} ${orgs === 1 ? "organization" : "organizations"}`);

  if (flag.rollout_percentage >= 100) {
    return named.length > 0 ? `Everybody (and ${named.join(", ")})` : "Everybody";
  }
  if (flag.rollout_percentage <= 0) {
    return named.length > 0 ? `Only ${named.join(", ")}` : "Nobody — no rollout and nobody named";
  }
  const share = `${flag.rollout_percentage}% of people, always the same ones`;
  return named.length > 0 ? `${share}, plus ${named.join(", ")}` : share;
}

/** How much a switch-off takes away, counted — empty when the flag gates nothing known. */
export function blastRadius(controls: FlagControls | undefined): string[] {
  if (!controls) return [];
  const parts: string[] = [];
  const count = (n: number, one: string, many: string) => (n > 0 ? [`${n} ${n === 1 ? one : many}`] : []);
  parts.push(...count(controls.routes.length, "page", "pages"));
  parts.push(...count(controls.components.length, "component", "components"));
  parts.push(...count(controls.endpoints.length, "API endpoint", "API endpoints"));
  parts.push(...count(controls.jobs.length, "background job", "background jobs"));
  parts.push(...count(controls.dependents.length, "dependent flag", "dependent flags"));
  return parts;
}

/** What a flag controls, as lists — used in the confirmation and the drawer. */
export function ControlsList({ controls, names }: { controls: FlagControls | undefined; names: Record<string, string> }) {
  if (!controls || blastRadius(controls).length === 0 && controls.nav.length === 0 && controls.live.length === 0) {
    return <Text type="secondary">Nothing the catalogue knows of reads this flag — it is an installation&apos;s own.</Text>;
  }
  const section = (title: string, items: string[], mono = false) =>
    items.length > 0 && (
      <div className="nx-ff-controls-section">
        <div className="nx-ff-controls-title">{title}</div>
        <ul>
          {items.map((item) => (
            <li key={item} className={mono ? "nu-mono" : undefined}>
              {item}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="nx-ff-controls" data-testid="flag-controls">
      {section("Pages that show “switched off”", controls.routes, true)}
      {section("Menu entries hidden", controls.nav, true)}
      {section("Components that disappear", controls.components)}
      {section(
        "API endpoints that refuse (404 feature_disabled)",
        controls.endpoints.map((endpoint) => `${endpoint.methods.join(", ")} ${endpoint.url}`),
        true,
      )}
      {section("Background jobs skipped", controls.jobs, true)}
      {section(
        "Live messages not delivered",
        controls.live.map((kind) => (kind === "*" ? "the whole live channel" : kind)),
        true,
      )}
      {section("Payload rules", controls.payload_rules)}
      {section(
        "Flags that go off with it",
        controls.dependents.map((key) => names[key] ?? key),
      )}
    </div>
  );
}

export default function FlagsPage() {
  const phone = usePhoneList();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<FeatureFlag | null>(null);
  const [form] = Form.useForm<{ key: string; name: string; description?: string }>();
  const drawer = useUrlOverlay("flag");
  const { touch, settled, requestClose } = useDiscardGuard({
    close: () => {
      form.resetFields();
      setCreating(false);
    },
    what: "flag",
  });

  const state = params.get("state") ?? "";
  const term = params.get("q") ?? "";
  const previewRole = params.get("as") ?? "";
  const [search, setSearch] = useState(term);
  useEffect(() => setSearch(term), [term]);

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

  const flags = useQuery({
    queryKey: ["admin-flags", state],
    queryFn: ({ signal }) => settingsApi.flags(state && state !== "PARTIAL" ? { state } : {}, signal),
  });
  const roles = useQuery({ queryKey: ["meta-roles"], queryFn: ({ signal }) => metaApi.roles(signal), staleTime: 300_000 });
  const preview = useQuery({
    queryKey: ["admin-flags", "preview", previewRole],
    queryFn: ({ signal }) => settingsApi.flagPreview({ role: previewRole }, signal),
    enabled: Boolean(previewRole),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-flags"] });
    // And the profile, which carries the features that are on for this
    // reader — the menu and the pages follow at once.
    void queryClient.invalidateQueries({ queryKey: ["me"] });
  };

  const write = useMutation({
    mutationFn: ({ key, body }: { key: string; body: Record<string, unknown> }) =>
      settingsApi.updateFlag(key, body),
    onSuccess: (flag) => {
      message.success(`${flag.name} is ${flag.enabled ? "on" : "off"}`);
      refresh();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That change was refused."),
  });

  const create = useMutation({
    mutationFn: (values: { key: string; name: string; description?: string }) =>
      settingsApi.createFlag(values),
    onSuccess: (flag) => {
      settled();
      message.success(`${flag.name} exists, and it is off`);
      form.resetFields();
      setCreating(false);
      refresh();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That flag could not be created."),
  });

  const remove = useMutation({
    mutationFn: (key: string) => settingsApi.removeFlag(key),
    onSuccess: (answer) => {
      message.success(`${answer.key} is gone`);
      refresh();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That flag could not be removed."),
  });

  usePageCommands("admin-flags", [
    { id: "flags.new", label: "Add a feature flag", keywords: "flag feature rollout toggle", run: () => setCreating(true) },
    { id: "flags.on", label: "Show the flags that are on", keywords: "flag enabled live", run: () => set({ state: "ON" }) },
    { id: "flags.off", label: "Show the flags that are off", keywords: "flag disabled hidden switched off", run: () => set({ state: "OFF" }) },
    { id: "flags.partial", label: "Show the flags mid-rollout", keywords: "flag rollout percentage partial gradual some", run: () => set({ state: "PARTIAL" }) },
    { id: "flags.all", label: "Show every flag", keywords: "flag all clear filter everything", run: () => set({ state: null, q: null }) },
  ]);

  const names = useMemo(
    () => Object.fromEntries((flags.data?.items ?? []).map((flag) => [flag.key, flag.name])),
    [flags.data],
  );

  if (flags.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (flags.isError) {
    return (
      <div className="nx-ad nx-ad--flags">
        <PageHeader title={<>Feature <em>flags</em></>} />
        <Alert
          type="error"
          showIcon
          message={flags.error instanceof ApiError ? flags.error.message : "The flags could not be loaded."}
        />
      </div>
    );
  }

  const data = flags.data!;
  const needle = term.trim().toLowerCase();
  const visible = data.items.filter(
    (flag) =>
      (state !== "PARTIAL" || flag.partial) &&
      (!needle ||
        flag.key.includes(needle) ||
        flag.name.toLowerCase().includes(needle) ||
        (flag.description ?? "").toLowerCase().includes(needle)),
  );
  const areaLabels = Object.fromEntries((data.areas ?? []).map((area) => [area.key, area.label]));
  const areaOrder = (data.areas ?? []).map((area) => area.key);
  const grouped = new Map<string, FeatureFlag[]>();
  for (const flag of visible) {
    const area = flag.area ?? "custom";
    grouped.set(area, [...(grouped.get(area) ?? []), flag]);
  }
  const groups = [...grouped.entries()].sort(
    ([a], [b]) => (areaOrder.indexOf(a) + 1 || 999) - (areaOrder.indexOf(b) + 1 || 999),
  );

  /** A switch flipped. Off, for a flag that gates something, is confirmed first. */
  const toggle = (row: FeatureFlag, next: boolean) => {
    if (!next && blastRadius(row.controls).length > 0) {
      setConfirming(row);
      return;
    }
    write.mutate({ key: row.key, body: { enabled: next } });
  };

  const reachCell = (row: FeatureFlag) => (
    <div className="nu-flag-reach">
      <Text type={row.enabled ? undefined : "secondary"}>{reachOf(row)}</Text>
      {row.enabled && (
        <Slider
          min={0}
          max={100}
          step={5}
          value={row.rollout_percentage}
          disabled={write.isPending}
          tooltip={{ formatter: (value) => `${value}% of people` }}
          ariaLabelForHandle={`Rollout for ${row.name}`}
          onChangeComplete={(next) => write.mutate({ key: row.key, body: { rollout_percentage: next } })}
        />
      )}
    </div>
  );

  const allColumns: ColumnsType<FeatureFlag> = [
    {
      title: "Flag",
      dataIndex: "name",
      ellipsis: !phone,
      render: (name: string, row) => (
        <div className="nu-flag-cell">
          <Space size={6} wrap>
            <Text strong>{name}</Text>
            {row.stage !== "GA" && <Tag bordered={false}>{row.stage.toLowerCase()}</Tag>}
            {row.experimental && (
              <Tooltip title="Marked experimental, so the navigation badges whatever it guards (§1).">
                <Tag bordered={false}>experimental</Tag>
              </Tooltip>
            )}
            {(row.requires ?? []).length > 0 && (
              <Tooltip title={`Also needs ${(row.requires ?? []).map((key) => names[key] ?? key).join(", ")} to be on.`}>
                <Tag bordered={false} className="nx-ff-needs">
                  needs {(row.requires ?? []).map((key) => names[key] ?? key).join(", ")}
                </Tag>
              </Tooltip>
            )}
          </Space>
          <Text type="secondary" className="nu-flag-key">
            {row.key}
            {row.description ? ` · ${row.description}` : ""}
          </Text>
          {phone && reachCell(row)}
        </div>
      ),
    },
    {
      title: "On",
      key: "enabled",
      width: 72,
      render: (_value: unknown, row) => (
        <Switch
          size="small"
          checked={row.enabled}
          loading={write.isPending && write.variables?.key === row.key}
          aria-label={`${row.enabled ? "Turn off" : "Turn on"} ${row.name}`}
          onChange={(next) => toggle(row, next)}
        />
      ),
    },
    { title: "Reach", key: "reach", width: 280, render: (_value: unknown, row) => reachCell(row) },
    {
      title: "For you",
      key: "mine",
      width: 92,
      render: (_value: unknown, row) => (
        <Tooltip
          title={
            row.on_for_me
              ? "You are in the rollout, so you see whatever this guards."
              : "You are not in the rollout (or a flag it needs is off) — the same answer on every request."
          }
        >
          <Tag color={row.on_for_me ? "success" : undefined} bordered={false}>
            {row.on_for_me ? "yes" : "no"}
          </Tag>
        </Tooltip>
      ),
    },
    ...(previewRole
      ? [
          {
            title: `As ${previewRole.toLowerCase()}`,
            key: "preview",
            width: 108,
            render: (_value: unknown, row: FeatureFlag) => {
              const on = preview.data?.features[row.key];
              const depends = preview.data?.depends_on_person.includes(row.key);
              if (on === undefined) return <Text type="secondary">…</Text>;
              return (
                <Tag color={on ? "success" : depends ? "warning" : undefined} bordered={false} data-testid={`preview-${row.key}`}>
                  {on ? "yes" : depends ? "some" : "no"}
                </Tag>
              );
            },
          },
        ]
      : []),
    {
      title: "Last toggled",
      dataIndex: "last_toggled_at",
      width: 120,
      render: (value: string | null) =>
        value ? (
          <Tooltip title={absoluteTime(value)}>
            <Text type="secondary">{relativeTime(value)}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">never</Text>
        ),
    },
    {
      title: "",
      key: "actions",
      width: 92,
      align: "end",
      render: (_value: unknown, row) => (
        <Space size={2}>
          <Tooltip title="Rollout, targeting, what it controls and its history">
            <Button
              type="text"
              icon={<SettingOutlined />}
              aria-label={`Configure ${row.name}`}
              data-testid={`configure-flag-${row.key}`}
              onClick={() => drawer.open(row.key)}
            />
          </Tooltip>
          <Popconfirm
            title={`Delete ${row.name}?`}
            description={
              row.enabled
                ? "It is on. Turn it off first — deleting a live flag ships whatever it guards to everybody."
                : "Nothing will read it again."
            }
            okText="Delete"
            okButtonProps={{ danger: true }}
            disabled={row.enabled}
            onConfirm={() => remove.mutate(row.key)}
          >
            <Tooltip title={row.enabled ? "Turn it off before deleting it" : undefined}>
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                disabled={row.enabled}
                loading={remove.isPending && remove.variables === row.key}
                aria-label={`Delete ${row.name}`}
                data-testid={`delete-flag-${row.key}`}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];
  const PHONE_HIDDEN = new Set(["reach", "mine", "last_toggled_at", "preview"]);
  const columns = phone
    ? allColumns.filter((column) => {
        const id = String((column as { key?: string; dataIndex?: string }).key ?? (column as { dataIndex?: string }).dataIndex ?? "");
        return !PHONE_HIDDEN.has(id);
      })
    : allColumns;

  const selected = data.items.find((flag) => flag.key === drawer.value);

  return (
    <div className="nx-ad nx-ad--flags">
      <PageHeader
        title={<>Feature <em>flags</em></>}
        subtitle="What is switched on, for whom, and what switching it off takes away. Changes reach every open tab at once."
        tag={
          <Space size={6}>
            <Tag color={data.counts.on > 0 ? "blue" : undefined}>
              {data.counts.on} of {data.counts.total} on
            </Tag>
            {data.counts.partial > 0 && (
              <Tooltip title="On for a share of people rather than everybody.">
                <Tag>{data.counts.partial} rolling out</Tag>
              </Tooltip>
            )}
          </Space>
        }
        actions={
          <Space size={8} wrap>
            <Input.Search
              allowClear
              placeholder="Search flags"
              aria-label="Search flags"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onSearch={(value) => set({ q: value.trim() || null })}
              style={{ width: phone ? "100%" : 220 }}
              data-testid="flag-search"
            />
            <Segmented
              aria-label="State"
              value={state || "all"}
              onChange={(next) => set({ state: next === "all" ? null : String(next) })}
              options={[
                { value: "all", label: `All (${data.counts.total})` },
                { value: "ON", label: `On (${data.counts.on})` },
                { value: "OFF", label: "Off" },
                { value: "PARTIAL", label: "Rolling out" },
              ]}
            />
            <Select
              allowClear
              placeholder={<><EyeOutlined /> Preview as…</>}
              aria-label="Preview as a role"
              style={{ width: 170 }}
              value={previewRole || undefined}
              onChange={(value: string | undefined) => set({ as: value ?? null })}
              options={(roles.data?.items ?? []).map((role) => ({ value: role.code, label: role.name }))}
              data-testid="flag-preview-role"
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)} data-testid="new-flag">
              Add one
            </Button>
          </Space>
        }
      />

      {previewRole && preview.data && (
        <Alert
          className="nu-block"
          type="info"
          showIcon
          data-testid="flag-preview-summary"
          message={`As ${previewRole.toLowerCase()}: ${preview.data.off.length} of ${Object.keys(preview.data.features).length} features off`}
          description={
            preview.data.depends_on_person.length > 0
              ? `${preview.data.depends_on_person.length} more are rolling out by percentage — whether one person has them depends on who they are.`
              : undefined
          }
          action={<Button onClick={() => set({ as: null })}>Stop previewing</Button>}
        />
      )}

      <div className="nx-ff-groups" data-testid="flags-table">
        {groups.length === 0 && (
          <Card size="small">
            <EmptyState compact title="No flag matches" />
          </Card>
        )}
        {groups.map(([area, rows]) => (
          <Card
            key={area}
            size="small"
            className="nx-ff-group"
            data-testid={`flag-group-${area}`}
            title={
              <Space size={8}>
                <span>{areaLabels[area] ?? (area === "custom" ? "Custom" : area)}</span>
                <Tag bordered={false}>
                  {rows.filter((row) => row.enabled).length} of {rows.length} on
                </Tag>
              </Space>
            }
          >
            <Table<FeatureFlag>
              rowKey="key"
              size="small"
              pagination={false}
              tableLayout={phone ? "fixed" : undefined}
              columns={columns}
              dataSource={rows}
              locale={{ emptyText: <EmptyState compact title="No flag is in this state" /> }}
            />
          </Card>
        ))}
      </div>

      <Modal
        open={confirming !== null}
        title={confirming ? `Turn off ${confirming.name}?` : ""}
        okText="Turn it off"
        okButtonProps={{ danger: true, "data-testid": "confirm-flag-off" }}
        confirmLoading={write.isPending}
        onCancel={() => setConfirming(null)}
        onOk={() => {
          if (!confirming) return;
          write.mutate(
            { key: confirming.key, body: { enabled: false } },
            { onSettled: () => setConfirming(null) },
          );
        }}
        width={620}
      >
        {confirming && (
          <>
            <Alert
              className="nu-block"
              type="warning"
              showIcon
              message={`For everybody, at once: ${blastRadius(confirming.controls).join(", ")}.`}
              description="Open tabs follow within a moment; the API refuses the endpoints below with 404 feature_disabled."
            />
            <ControlsList controls={confirming.controls} names={names} />
          </>
        )}
      </Modal>

      <FlagDrawer
        flag={selected}
        open={Boolean(drawer.value)}
        names={names}
        roles={(roles.data?.items ?? []).map((role) => ({ value: role.code, label: role.name }))}
        saving={write.isPending}
        onClose={drawer.close}
        onSave={(body) => selected && write.mutate({ key: selected.key, body })}
      />

      <Modal
        open={creating}
        title="New feature flag"
        okText="Create it, off"
        confirmLoading={create.isPending}
        onCancel={requestClose}
        onOk={() => void form.submit()}
        okButtonProps={{ "data-testid": "create-flag" }}
      >
        <Alert
          className="nu-block"
          type="info"
          showIcon
          message="It arrives off, and reaching nobody"
          description="Turn it on and set its rollout when whatever it guards is ready to be seen."
        />
        <Form
          form={form}
          layout="vertical"
          onValuesChange={touch}
          requiredMark={false}
          onFinish={(values) => create.mutate(values)}
          data-testid="flag-form"
        >
          <Form.Item name="name" label="What does it guard?" rules={[{ required: true, message: "A flag needs a name" }]}>
            <Input autoFocus maxLength={160} placeholder="Saved chart thumbnails" aria-label="Flag name" />
          </Form.Item>
          <Form.Item
            name="key"
            label="Its key"
            extra="What the code checks for. Lower case, dashes, and never renamed."
            rules={[
              { required: true, message: "A flag needs a key" },
              { pattern: /^[a-z0-9-]{2,96}$/, message: "Lower case letters, digits and dashes" },
            ]}
          >
            <Input className="nu-mono" placeholder="saved-chart-thumbnails" aria-label="Flag key" />
          </Form.Item>
          <Form.Item name="description" label="Anything worth saying about it">
            <Input.TextArea rows={2} maxLength={2000} placeholder="Optional" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

interface Targeting {
  rollout_percentage: number;
  target_roles: string[];
  target_group_ids: string[];
  target_organization_ids: string[];
}

/** Rollout and targeting, what the flag controls, and its history. */
function FlagDrawer({
  flag,
  open,
  names,
  roles,
  saving,
  onClose,
  onSave,
}: {
  flag: FeatureFlag | undefined;
  open: boolean;
  names: Record<string, string>;
  roles: { value: string; label: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: (body: Partial<Targeting>) => void;
}) {
  const [draft, setDraftState] = useState<Targeting | null>(null);
  // Targeting is a set of choices somebody made one by one; closing the
  // drawer with them unsaved asks first (§76).
  const guard = useDiscardGuard({ close: onClose, what: "targeting" });
  const setDraft = (next: Targeting) => {
    guard.touch();
    setDraftState(next);
  };
  useEffect(() => {
    if (!flag) return;
    guard.settled();
    setDraftState({
      rollout_percentage: flag.rollout_percentage,
      target_roles: flag.target_roles,
      target_group_ids: flag.target_group_ids ?? [],
      target_organization_ids: flag.target_organization_ids ?? [],
    });
    // `guard.settled` is stable; re-running on it would reset the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag]);

  const groups = useQuery({
    queryKey: ["flag-groups"],
    queryFn: ({ signal }) => groupsApi.list({ page_size: 200 }, signal),
    enabled: open,
    staleTime: 60_000,
  });
  const organizations = useQuery({
    queryKey: ["flag-organizations"],
    queryFn: ({ signal }) => organizationsApi.list({}, signal),
    enabled: open,
    staleTime: 60_000,
  });
  const history = useQuery({
    queryKey: ["admin-flags", "history", flag?.key],
    queryFn: ({ signal }) => settingsApi.flagHistory(flag!.key, signal),
    enabled: open && Boolean(flag),
  });

  const changed =
    flag !== undefined &&
    draft !== null &&
    (draft.rollout_percentage !== flag.rollout_percentage ||
      draft.target_roles.join() !== flag.target_roles.join() ||
      draft.target_group_ids.join() !== (flag.target_group_ids ?? []).join() ||
      draft.target_organization_ids.join() !== (flag.target_organization_ids ?? []).join());

  return (
    <Drawer
      open={open}
      onClose={guard.requestClose}
      rootClassName={URL_OVERLAY}
      width={560}
      title={flag ? flag.name : "Flag"}
      data-testid="flag-drawer"
      extra={
        <Button
          type="primary"
          disabled={!changed}
          loading={saving}
          onClick={() => {
            if (!draft) return;
            guard.settled();
            onSave(draft);
          }}
          data-testid="save-targeting"
        >
          Save
        </Button>
      }
    >
      {!flag || !draft ? (
        <EmptyState compact title="That flag does not exist." />
      ) : (
        <Tabs
          items={[
            {
              key: "rollout",
              label: "Rollout & targeting",
              children: (
                <Form layout="vertical" data-testid="flag-targeting">
                  <Alert
                    className="nu-block"
                    type={flag.enabled ? "info" : "warning"}
                    showIcon
                    message={flag.enabled ? reachOf({ ...flag, ...draft }) : "The switch is off — targeting applies once it is on."}
                  />
                  <Form.Item label={`Everybody else: ${draft.rollout_percentage}% of people`}>
                    <Slider
                      min={0}
                      max={100}
                      step={5}
                      value={draft.rollout_percentage}
                      ariaLabelForHandle="Rollout percentage"
                      onChange={(value: number) => setDraft({ ...draft, rollout_percentage: value })}
                    />
                  </Form.Item>
                  <Form.Item label="Roles that always have it">
                    <Select
                      mode="multiple"
                      allowClear
                      aria-label="Target roles"
                      value={draft.target_roles}
                      options={roles}
                      onChange={(value: string[]) => setDraft({ ...draft, target_roles: value })}
                    />
                  </Form.Item>
                  <Form.Item label="Groups that always have it">
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      aria-label="Target groups"
                      loading={groups.isLoading}
                      value={draft.target_group_ids}
                      options={(groups.data?.items ?? []).map((group) => ({ value: group.id, label: group.name }))}
                      onChange={(value: string[]) => setDraft({ ...draft, target_group_ids: value })}
                    />
                  </Form.Item>
                  <Form.Item label="Organizations that always have it">
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      aria-label="Target organizations"
                      loading={organizations.isLoading}
                      value={draft.target_organization_ids}
                      options={(organizations.data?.items ?? []).map((org) => ({ value: org.id, label: org.name }))}
                      onChange={(value: string[]) => setDraft({ ...draft, target_organization_ids: value })}
                    />
                  </Form.Item>
                  {flag.target_user_ids.length > 0 && (
                    <Text type="secondary">
                      Also on for {flag.target_user_ids.length} named {flag.target_user_ids.length === 1 ? "person" : "people"}.
                    </Text>
                  )}
                </Form>
              ),
            },
            {
              key: "controls",
              label: "What it controls",
              children: <ControlsList controls={flag.controls} names={names} />,
            },
            {
              key: "history",
              label: "History",
              children: history.isLoading ? (
                <Skeleton active />
              ) : (history.data?.items ?? []).length === 0 ? (
                <EmptyState compact title="Never changed by hand" />
              ) : (
                <Timeline
                  data-testid="flag-history"
                  items={(history.data?.items ?? []).map((entry) => ({
                    children: (
                      <div className="nx-ff-history">
                        <Text strong>{entry.actor ?? "Somebody"}</Text> <Text>{entry.message}</Text>
                        <div>
                          <Text type="secondary">{entry.at ? `${relativeTime(entry.at)} · ${absoluteTime(entry.at)}` : ""}</Text>
                        </div>
                        {entry.changed_fields.length > 0 && (
                          <Text type="secondary" className="nu-mono">
                            {entry.changed_fields.join(", ")}
                          </Text>
                        )}
                      </div>
                    ),
                  }))}
                />
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}
