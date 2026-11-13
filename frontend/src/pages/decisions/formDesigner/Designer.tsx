import { useState, type DragEvent } from "react";
import { Alert, Card, Segmented, Typography } from "antd";

import type { FieldType, FormDetail, FormField, FormTarget } from "@/api/forms";
import { FormRenderer } from "@/components/decisions/FormRenderer";

import { FieldCanvas } from "./FieldCanvas";
import { FieldInspector } from "./FieldInspector";
import { Palette } from "./Palette";
import { moved, newField } from "./fieldTypes";

const { Text } = Typography;

export interface DragState {
  dragging: number | null;
  setDragging: (index: number | null) => void;
  over: number | null;
  setOver: (index: number | null) => void;
  canvasOver: boolean;
  setCanvasOver: (over: boolean) => void;
  /** A palette tool or a dragged field let go at a position. */
  drop: (at: number, event: DragEvent) => void;
}

interface DesignerProps {
  draft: FormDetail;
  target?: FormTarget;
  editable: boolean;
  onFields: (fields: FormField[]) => void;
}

/** Build the form: palette, canvas (or preview) and the selected field's inspector. */
export function Designer({ draft, target, editable, onFields }: DesignerProps) {
  const [selected, setSelected] = useState<string | null>(draft.fields[0]?.id ?? null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [canvasOver, setCanvasOver] = useState(false);
  const fields = draft.fields;
  const field = fields.find((item) => item.id === selected) ?? null;
  const index = field ? fields.indexOf(field) : -1;

  const add = (type: FieldType, at = fields.length) => {
    const created = newField(type, fields);
    const next = [...fields];
    next.splice(at, 0, created);
    onFields(next);
    setSelected(created.id);
  };
  const update = (patch: Partial<FormField>) => onFields(fields.map((item) => (item.id === selected ? { ...item, ...patch } : item)));
  const drop = (at: number, event: DragEvent) => {
    event.preventDefault();
    const tool = event.dataTransfer.getData("text/x-td-tool") as FieldType;
    if (tool) add(tool, at);
    else if (dragging !== null) onFields(moved(fields, dragging, at > dragging ? at - 1 : at));
    setDragging(null); setOver(null); setCanvasOver(false);
  };
  const drag: DragState = { dragging, setDragging, over, setOver, canvasOver, setCanvasOver, drop };

  const mappable = (target?.fields ?? []).filter((item) => item.kind !== "uuid" || !item.references);
  const used = new Set(fields.map((item) => item.map_to).filter(Boolean));
  const missing = (target?.fields ?? []).filter((item) => item.required && !used.has(item.name) && !(item.name in (draft.settings.defaults ?? {})));

  return (
    <>
      {missing.length > 0 && (
        <Alert type="warning" showIcon message={`Map a field to ${missing.map((item) => item.label.toLowerCase()).join(", ")} — a ${target?.label.replace(/s$/, "").toLowerCase()} cannot be created without it.`} />
      )}
      <div className="nx-td-designer">
        <Palette editable={editable} onAdd={(type: FieldType) => add(type)} />

        <Card
          size="small"
          title={<Segmented size="small" value={mode} onChange={(value) => setMode(value as "edit" | "preview")} options={[{ value: "edit", label: "Build" }, { value: "preview", label: "Preview" }]} />}
          extra={<Text type="secondary">{fields.filter((item) => item.type !== "heading").length} fields</Text>}
        >
          {mode === "preview" ? (
            <FormRenderer fields={fields} submitLabel={draft.settings.submit_label} disabled />
          ) : (
            <FieldCanvas
              fields={fields}
              selected={selected}
              onSelect={setSelected}
              editable={editable}
              target={target}
              onFields={onFields}
              drag={drag}
            />
          )}
        </Card>

        <FieldInspector field={field} index={index} fields={fields} editable={editable} mappable={mappable} used={used} update={update} />
      </div>
    </>
  );
}
