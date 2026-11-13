import { Button, Popconfirm, Slider, Space, Switch, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, SettingOutlined } from "@ant-design/icons";

import type { FeatureFlag } from "@/api/settings";
import { absoluteTime, relativeTime } from "@/lib/time";

import { reachOf } from "./flagReach";
import type { useFlagsPage } from "./useFlagsPage";

const { Text } = Typography;

type Page = ReturnType<typeof useFlagsPage>;

/** Columns a phone leaves out; the reach moves under the flag's name there. */
const PHONE_HIDDEN = new Set(["reach", "mine", "last_toggled_at", "preview"]);

/** "And do *I* have it?" — the server's answer, with the same rule it gates with. */
const MINE_COLUMN: ColumnsType<FeatureFlag>[number] = {
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
};

const TOGGLED_COLUMN: ColumnsType<FeatureFlag>[number] = {
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
};

/** The flag table's columns for one area, narrowed on a phone. */
export function flagColumns(page: Page, phone: boolean): ColumnsType<FeatureFlag> {
  const { write, names, previewRole } = page;
  const all: ColumnsType<FeatureFlag> = [
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
          {phone && <ReachCell row={row} write={write} />}
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
          onChange={(next) => page.toggle(row, next)}
        />
      ),
    },
    { title: "Reach", key: "reach", width: 280, render: (_value: unknown, row) => <ReachCell row={row} write={write} /> },
    MINE_COLUMN,
    ...(previewRole ? [previewColumn(page)] : []),
    TOGGLED_COLUMN,
    {
      title: "",
      key: "actions",
      width: 92,
      align: "end",
      render: (_value: unknown, row) => <FlagActions row={row} page={page} />,
    },
  ];
  if (!phone) return all;
  return all.filter((column) => {
    const id = String((column as { key?: string; dataIndex?: string }).key ?? (column as { dataIndex?: string }).dataIndex ?? "");
    return !PHONE_HIDDEN.has(id);
  });
}

function previewColumn({ previewRole, preview }: Page) {
  return {
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
  };
}

/** The share of people a flag reaches, with the slider that moves it. */
function ReachCell({ row, write }: { row: FeatureFlag; write: Page["write"] }) {
  return (
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
}

function FlagActions({ row, page }: { row: FeatureFlag; page: Page }) {
  const { drawer, remove } = page;
  return (
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
  );
}
