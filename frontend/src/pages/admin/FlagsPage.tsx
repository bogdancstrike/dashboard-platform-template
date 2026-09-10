/**
 * `/admin/flags` — feature flags (§27, §20).
 *
 * Four decisions worth stating.
 *
 * **Every row answers "and do *I* have it?".** A list of flags with a global
 * on/off says nothing about what the person reading it will actually see, and
 * "it is enabled but I do not have it" is the commonest question a flag screen
 * gets. The server computes it with the same function it would gate anything
 * with, so the answer on screen cannot disagree with the answer in the API.
 *
 * **The switch is in the row.** Turning a flag off is the urgent thing on this
 * page — usually because something is on fire — and it should never be three
 * clicks deep.
 *
 * **A partial rollout says what it means.** "50%" beside a switch reads as
 * half-on; "on for half of everybody, and for you" is a fact. The rollout is
 * a stable hash of the flag and the person, so it is the same answer on every
 * request, and the row says so rather than leaving somebody to wonder why it
 * flickers.
 *
 * **Deleting is refused while it is on**, by the server, and the page says why
 * before it is tried rather than after.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Skeleton,
  Slider,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { settingsApi, type FeatureFlag } from "@/api/settings";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { absoluteTime, relativeTime } from "@/lib/time";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

const { Text } = Typography;

/**
 * What a flag's reach adds up to, in words.
 *
 * Pure and exported. This is the sentence the page exists to say, and the four
 * cases are worth stating exactly: off, on for everybody, on for a named set,
 * and on for a share of people. "50%" on its own is the one answer that leaves
 * a reader guessing.
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

  if (flag.rollout_percentage >= 100) {
    return named.length > 0 ? `Everybody (and ${named.join(", ")})` : "Everybody";
  }
  if (flag.rollout_percentage <= 0) {
    return named.length > 0 ? `Only ${named.join(", ")}` : "Nobody — no rollout and nobody named";
  }
  const share = `${flag.rollout_percentage}% of people, always the same ones`;
  return named.length > 0 ? `${share}, plus ${named.join(", ")}` : share;
}

export default function FlagsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ key: string; name: string; description?: string }>();
  const { touch, settled, requestClose } = useDiscardGuard({
    close: () => {
      form.resetFields();
      setCreating(false);
    },
    what: "flag",
  });

  const state = params.get("state") ?? "";

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
    queryFn: ({ signal }) => settingsApi.flags(state ? { state } : {}, signal),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-flags"] });
    // And the profile, which carries the features that are on for this reader
    // (§27). Without it, turning a flag on left the navigation unchanged
    // until a reload — which is precisely the "this screen does nothing"
    // impression the flags page used to give.
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
    {
      id: "flags.new",
      label: "Add a feature flag",
      keywords: "flag feature rollout toggle",
      run: () => setCreating(true),
    },
    {
      id: "flags.on",
      label: "Show the flags that are on",
      keywords: "flag enabled live",
      run: () => set({ state: "ON" }),
    },
  ]);

  if (flags.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (flags.isError) {
    return (
      <>
        <PageHeader title="Feature flags" />
        <Alert
          type="error"
          showIcon
          message={
            flags.error instanceof ApiError
              ? flags.error.message
              : "The flags could not be loaded."
          }
        />
      </>
    );
  }

  const data = flags.data!;

  const columns: ColumnsType<FeatureFlag> = [
    {
      title: "Flag",
      dataIndex: "name",
      ellipsis: true,
      render: (name: string, row) => (
        <div className="nu-flag-cell">
          <Space size={6}>
            <Text strong>{name}</Text>
            {row.experimental && (
              <Tooltip title="Marked experimental, so the navigation badges whatever it guards (§1).">
                <Tag bordered={false}>experimental</Tag>
              </Tooltip>
            )}
          </Space>
          <Text type="secondary" className="nu-flag-key">
            {row.key}
            {row.description ? ` · ${row.description}` : ""}
          </Text>
        </div>
      ),
    },
    {
      title: "On",
      key: "enabled",
      width: 72,
      render: (_value: unknown, row) => (
        // In the row: turning a flag off is the urgent thing on this page,
        // usually because something is on fire.
        <Switch
          size="small"
          checked={row.enabled}
          loading={write.isPending}
          aria-label={`${row.enabled ? "Turn off" : "Turn on"} ${row.name}`}
          onChange={(next) => write.mutate({ key: row.key, body: { enabled: next } })}
        />
      ),
    },
    {
      title: "Reach",
      key: "reach",
      width: 300,
      render: (_value: unknown, row) => (
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
              // Not `aria-label`: that lands on the wrapper, and the element
              // carrying `role="slider"` is the *handle*. A table of these
              // was a table of unnamed inputs — nine on one screen, each
              // announced as "50, slider" with no clue which flag it moves.
              ariaLabelForHandle={`Rollout for ${row.name}`}
              onChangeComplete={(next) =>
                write.mutate({ key: row.key, body: { rollout_percentage: next } })
              }
            />
          )}
        </div>
      ),
    },
    {
      title: "For you",
      key: "mine",
      width: 108,
      render: (_value: unknown, row) => (
        // The answer to "it is enabled but I do not have it", computed by the
        // same function the API would gate anything with.
        <Tooltip
          title={
            row.on_for_me
              ? "You are in the rollout, so you see whatever this guards."
              : "You are not in the rollout — the same answer on every request."
          }
        >
          <Tag color={row.on_for_me ? "success" : undefined} bordered={false}>
            {row.on_for_me ? "yes" : "no"}
          </Tag>
        </Tooltip>
      ),
    },
    {
      title: "Stage",
      dataIndex: "stage",
      width: 96,
      render: (stage: string) => <Tag bordered={false}>{stage.toLowerCase()}</Tag>,
    },
    {
      title: "Last toggled",
      dataIndex: "last_toggled_at",
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
    {
      title: "",
      key: "remove",
      width: 48,
      align: "end",
      render: (_value: unknown, row) => (
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
          <Tooltip
            title={row.enabled ? "Turn it off before deleting it" : undefined}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              // Disabled with the reason rather than absent: deleting a flag
              // *is* something an administrator does, once it is off (§76).
              disabled={row.enabled}
              loading={remove.isPending}
              aria-label={`Delete ${row.name}`}
              data-testid={`delete-flag-${row.key}`}
            />
          </Tooltip>
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Feature flags"
        subtitle="What is switched on, for whom, and whether you have it. A change applies to the next request."
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
          <Space size={8}>
            <Segmented
              aria-label="State"
              value={state || "all"}
              onChange={(next) => set({ state: next === "all" ? null : String(next) })}
              options={[
                { value: "all", label: `All (${data.counts.total})` },
                { value: "ON", label: `On (${data.counts.on})` },
                { value: "OFF", label: "Off" },
              ]}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreating(true)}
              data-testid="new-flag"
            >
              Add one
            </Button>
          </Space>
        }
      />

      <div className="nu-fill">
        <Card size="small" className="nu-pane nu-pane--table" data-testid="flags-table">
          <Table<FeatureFlag>
            rowKey="key"
            size="small"
            sticky
            pagination={false}
            columns={columns}
            dataSource={data.items}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No flag is in this state"
                />
              ),
            }}
          />
        </Card>
      </div>

      <Modal
        open={creating}
        title="New feature flag"
        okText="Create it, off"
        confirmLoading={create.isPending}
        onCancel={requestClose}
        onOk={() => void form.submit()}
        okButtonProps={{ "data-testid": "create-flag" }}
      >
        {/* Said before it is created, not after: a flag that arrived on would
            ship whatever it guards at the moment it was made. */}
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
          <Form.Item
            name="name"
            label="What does it guard?"
            rules={[{ required: true, message: "A flag needs a name" }]}
          >
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
    </>
  );
}
