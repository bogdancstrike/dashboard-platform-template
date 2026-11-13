import { Button, Card, Input, Select, Space } from "antd";

import { PeoplePicker } from "@/components/PeoplePicker";

import type { KanbanPageModel } from "./useKanbanPage";

/** Search, kind, label and assignee — each in the address — and Clear. */
export function BoardFilters({ m, filtered }: { m: KanbanPageModel; filtered: boolean }) {
  const { term, setTerm, label, kind, assignee, set, detail } = m;
  return (
    <Card size="small" className="nu-filter-bar nu-block">
      <Space size={8} wrap>
        <Input.Search
          allowClear
          placeholder="Search this board"
          aria-label="Search this board"
          style={{ width: 220 }}
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            set({ q: event.target.value || null });
          }}
        />
        <Select
          aria-label="Kind"
          style={{ minWidth: 130 }}
          allowClear
          placeholder="Any kind"
          value={kind || undefined}
          onChange={(next: string | undefined) => set({ kind: next ?? null })}
          options={(detail?.kinds ?? []).map((item) => ({
            value: item.key,
            label: item.key.charAt(0) + item.key.slice(1).toLowerCase(),
          }))}
        />
        <Select
          aria-label="Label"
          style={{ minWidth: 150 }}
          allowClear
          showSearch
          placeholder="Any label"
          value={label || undefined}
          onChange={(next: string | undefined) => set({ label: next ?? null })}
          // What is on the board, not a text box that matches nothing.
          options={(detail?.labels ?? []).map((item) => ({ value: item, label: item }))}
        />
        <div style={{ minWidth: 220 }}>
          <PeoplePicker
            multiple={false}
            aria-label="Assignee"
            placeholder="Anybody"
            value={assignee ? [assignee] : []}
            onChange={(ids) => set({ assignee: ids[0] ?? null })}
          />
        </div>
        {filtered && (
          <Button
            type="text"
            onClick={() => {
              setTerm("");
              set({ label: null, kind: null, assignee: null, q: null });
            }}
          >
            Clear
          </Button>
        )}
      </Space>
    </Card>
  );
}
