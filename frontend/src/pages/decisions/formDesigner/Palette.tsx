import { Card } from "antd";

import type { FieldType } from "@/api/forms";
import { NxIcon } from "@/components/NxIcon";

import { FIELD_TYPES } from "./fieldTypes";

/** The field types, to drag onto the form or click to add at the end. */
export function Palette({ editable, onAdd }: { editable: boolean; onAdd: (type: FieldType) => void }) {
  return (
    <Card size="small" title="Fields">
      <div className="nx-td-palette" aria-label="Field types">
        {FIELD_TYPES.map((tool) => (
          <button
            key={tool.type}
            type="button"
            className="nx-td-tool"
            draggable={editable}
            disabled={!editable}
            onDragStart={(event) => { event.dataTransfer.setData("text/x-td-tool", tool.type); event.dataTransfer.effectAllowed = "copy"; }}
            onClick={() => onAdd(tool.type)}
            data-testid={`form-tool-${tool.type}`}
            title={`${tool.label} — ${tool.hint}. Drag onto the form, or click to add at the end.`}
          >
            <NxIcon name="plus" size={14} /> {tool.label}
          </button>
        ))}
      </div>
    </Card>
  );
}
