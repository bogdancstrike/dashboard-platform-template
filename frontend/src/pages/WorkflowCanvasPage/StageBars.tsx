import { Button, Dropdown, Segmented, Select, Typography } from "antd";

import { NxIcon } from "@/components/NxIcon";

import type { Mode } from "./canvasOverlays";
import type { useWorkflowCanvasPage } from "./useWorkflowCanvasPage";

const { Text } = Typography;

type Page = ReturnType<typeof useWorkflowCanvasPage>;

/** Edit, test or history; adding a step on a narrow screen; tidying; and whether the draft is saved. */
export function StageToolbar({ page, readOnly, saveState }: { page: Page; readOnly: boolean; saveState: string }) {
  const { mode, setMode, narrow, palette, add, canvas } = page;
  const data = page.data!;
  const { setTrace } = page.draft;
  return (
    <div className="nx-wf-toolbar">
      <Segmented
        aria-label="Canvas mode"
        value={mode}
        onChange={(value) => { setMode(value as Mode); if (value !== "test") setTrace(null); }}
        options={[
          { value: "edit", label: "Edit" },
          { value: "test", label: "Test" },
          { value: "history", label: `History${data.stats.runs ? ` · ${data.stats.runs}` : ""}` },
        ]}
      />
      {narrow && mode === "edit" && data.can_edit && (
        <Dropdown
          trigger={["click"]}
          menu={{ items: palette.map((item, index) => ({ key: String(index), label: item.label, onClick: () => add(index) })) }}
        >
          <Button data-testid="add-step" icon={<NxIcon name="plus" size={14} />}>Add step</Button>
        </Dropdown>
      )}
      {mode === "edit" && (
        <Button onClick={() => canvas.current?.layout()} disabled={readOnly} data-testid="auto-layout">Tidy</Button>
      )}
      <span className="nx-wf-save" aria-live="polite">{mode === "edit" ? saveState : null}</span>
    </div>
  );
}

/** Pick a real record and walk it through the draft with the actions switched off. */
export function TestBar({ page }: { page: Page }) {
  const { sample, setSample, setSampleSearch, samples, test } = page.tester;
  return (
    <div className="nx-wf-testbar" data-testid="test-bar">
      <Select
        showSearch
        filterOption={false}
        onSearch={setSampleSearch}
        aria-label="Sample record"
        placeholder="Pick a record to walk through the draft"
        value={sample}
        onChange={setSample}
        loading={samples.isFetching}
        options={(samples.data?.items ?? []).map((item) => ({ value: item.id, label: item.status ? `${item.label} · ${item.status}` : item.label }))}
        className="nx-wf-sample"
      />
      <Button type="primary" disabled={!sample} loading={test.isPending} onClick={() => sample && test.mutate(sample)} data-testid="run-test">
        Run test
      </Button>
      <Text type="secondary" className="nx-wf-hint">Nothing is sent or changed — the actions are switched off.</Text>
    </div>
  );
}
