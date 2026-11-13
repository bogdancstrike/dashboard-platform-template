import { Alert, Button, Input, Segmented, Select, Space, Tag, Tooltip } from "antd";
import { EyeOutlined, PlusOutlined } from "@ant-design/icons";

import type { FlagsPage as FlagCatalogue } from "@/api/settings";

import type { useFlagsPage } from "./useFlagsPage";

type Page = ReturnType<typeof useFlagsPage>;

/** How many flags are on, and how many are rolling out. */
export function FlagCounts({ counts }: { counts: FlagCatalogue["counts"] }) {
  return (
    <Space size={6}>
      <Tag color={counts.on > 0 ? "blue" : undefined}>
        {counts.on} of {counts.total} on
      </Tag>
      {counts.partial > 0 && (
        <Tooltip title="On for a share of people rather than everybody.">
          <Tag>{counts.partial} rolling out</Tag>
        </Tooltip>
      )}
    </Space>
  );
}

/** Search, state, "preview as" and the create button, in the page header. */
export function FlagControls({ page, total, on, phone }: { page: Page; total: number; on: number; phone: boolean }) {
  const { search, setSearch, set, state, previewRole, roles } = page;
  return (
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
          { value: "all", label: `All (${total})` },
          { value: "ON", label: `On (${on})` },
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
      <Button type="primary" icon={<PlusOutlined />} onClick={() => page.setCreating(true)} data-testid="new-flag">
        Add one
      </Button>
    </Space>
  );
}

/** What the previewed role would have, with the way out of the preview. */
export function PreviewSummary({ page }: { page: Page }) {
  const { previewRole, preview, set } = page;
  if (!previewRole || !preview.data) return null;
  return (
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
  );
}
