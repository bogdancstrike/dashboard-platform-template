import { Button, Checkbox, Input, Space } from "antd";
import { DeleteOutlined, HolderOutlined, PlusOutlined } from "@ant-design/icons";
import { useState } from "react";

import { DropGap, useBoardDrag } from "@/components/kanban/useBoardDrag";

/** A checklist whose steps can be dragged into a new order (and ticked, added, removed). */
export function ReorderableChecklist({
  items,
  canEdit,
  saving,
  onChange,
}: {
  items: { text: string; done: boolean }[];
  canEdit: boolean;
  saving: boolean;
  onChange: (items: { text: string; done: boolean }[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const keyed = items.map((item, index) => ({ ...item, key: `step-${index}` }));
  const drag = useBoardDrag({
    enabled: canEdit && !saving,
    lanes: ["checklist"],
    items: () => keyed.map((item) => item.key),
    onDrop: (key, _from, to) => {
      const from = keyed.findIndex((item) => item.key === key);
      if (from < 0) return;
      const rest = items.filter((_item, index) => index !== from);
      onChange([...rest.slice(0, to.index), items[from]!, ...rest.slice(to.index)]);
    },
    describe: (key) => keyed.find((item) => item.key === key)?.text ?? "the step",
    laneName: () => "the checklist",
  });
  const add = () => {
    if (!draft.trim()) return;
    onChange([...items, { text: draft.trim(), done: false }]);
    setDraft("");
  };
  return (
    <div data-drop-lane="checklist" className={drag.laneProps("checklist").className}>
      <ul className="nx-pl-checklist" data-drop-list="checklist">
        {drag.renderLane(
          "checklist",
          keyed,
          (item) => item.key,
          (item, index) => {
            const { className, ...handlers } = drag.cardProps(item.key, "checklist");
            return (
              <li key={item.key}>
                <div {...handlers} className={`nx-pl-checklist-row ${className}`} data-testid={`checklist-row-${index}`}>
                  {canEdit && <HolderOutlined className="nx-pl-handle" aria-hidden />}
                  <Checkbox
                    checked={item.done}
                    disabled={!canEdit || saving}
                    onChange={(event) =>
                      onChange(items.map((entry, position) => (position === index ? { ...entry, done: event.target.checked } : entry)))
                    }
                  >
                    <span className={item.done ? "nu-checklist-done" : undefined}>{item.text}</span>
                  </Checkbox>
                  {canEdit && (
                    <Button
                      type="text"
                      data-no-drag
                      aria-label={`Remove ${item.text}`}
                      icon={<DeleteOutlined />}
                      onClick={() => onChange(items.filter((_entry, position) => position !== index))}
                    />
                  )}
                </div>
              </li>
            );
          },
          (height) => <DropGap key="gap" height={Math.min(height, 36)} label="" />,
        )}
      </ul>
      {canEdit && (
        <Space.Compact style={{ width: "100%" }}>
          <Input aria-label="New checklist item" placeholder="Add a step" value={draft} onChange={(event) => setDraft(event.target.value)} onPressEnter={add} />
          <Button icon={<PlusOutlined />} disabled={!draft.trim()} onClick={add}>
            Add
          </Button>
        </Space.Compact>
      )}
      {drag.overlay}
    </div>
  );
}
