import { Card } from "antd";

import { NxIcon, type NxIconName } from "@/components/NxIcon";
import { DRAG_TYPE } from "@/components/workflows/WorkflowCanvas";
import { iconFor, str } from "@/components/workflows/graph";

import type { PaletteItem } from "./palette";

/** The steps, grouped, to drag onto the canvas or click to add after the selected one. */
export function StepPalette({ palette, readOnly, onAdd }: { palette: PaletteItem[]; readOnly: boolean; onAdd: (index: number) => void }) {
  return (
    <Card size="small" className="nx-wf-palette" data-testid="workflow-palette" title="Steps">
      {(["Logic", "Actions", "Flow"] as const).map((group) => (
        <div key={group} className="nx-wf-palette-group">
          <div className="nx-wf-label">{group}</div>
          {palette.map((item, index) => item.group === group && (
            <button
              key={`${item.label}-${index}`}
              type="button"
              className="nx-wf-palette-item"
              draggable={!readOnly}
              disabled={readOnly}
              data-testid={`palette-${item.type === "action" ? str(item.data.kind) : item.type}`}
              onDragStart={(event) => event.dataTransfer.setData(DRAG_TYPE, String(index))}
              onClick={() => onAdd(index)}
              title={item.description}
            >
              <span className="nx-wf-palette-icon"><NxIcon name={iconFor(item) as NxIconName} size={15} /></span>
              <span className="nx-wf-palette-text">
                <span>{item.label}</span>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </div>
      ))}
    </Card>
  );
}
