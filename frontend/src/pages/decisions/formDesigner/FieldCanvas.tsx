import { Button, Space } from "antd";

import type { FormField, FormTarget } from "@/api/forms";
import { TdIcon } from "@/components/icons/TdIcon";
import { asText } from "@/lib/text";

import type { DragState } from "./Designer";
import { TYPE_LABEL, moved } from "./fieldTypes";

interface FieldCanvasProps {
  fields: FormField[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  editable: boolean;
  target?: FormTarget;
  onFields: (fields: FormField[]) => void;
  drag: DragState;
}

/** The form's fields in order: a drop target for the palette, and rows to drag into order. */
export function FieldCanvas(props: FieldCanvasProps) {
  const { fields, drag } = props;
  return (
    <div
      className={`nx-td-canvas${drag.canvasOver ? " is-over" : ""}`}
      onDragOver={(event) => { event.preventDefault(); drag.setCanvasOver(true); }}
      onDragLeave={() => drag.setCanvasOver(false)}
      onDrop={(event) => drag.drop(fields.length, event)}
      data-testid="form-canvas"
    >
      {fields.length === 0 && <div className="nx-td-drop">Drag a field here</div>}
      {fields.map((item, position) => (
        <FieldRow key={item.id} item={item} position={position} {...props} />
      ))}
    </div>
  );
}

function FieldRow({ item, position, fields, selected, onSelect, editable, target, onFields, drag }: FieldCanvasProps & { item: FormField; position: number }) {
  const { dragging, over, setDragging, setOver, drop } = drag;
  const setSelected = onSelect;
  return (
    <div
      className={`nx-td-field${item.type === "heading" ? " nx-td-field--heading" : ""}${item.id === selected ? " is-on" : ""}${dragging === position ? " is-dragging" : ""}${over === position ? " is-target" : ""}`}
      draggable={editable}
      onDragStart={(event) => { setDragging(position); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }}
      onDragEnd={() => { setDragging(null); setOver(null); }}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setOver(position); }}
      onDrop={(event) => { event.stopPropagation(); drop(position, event); }}
      onClick={() => setSelected(item.id)}
      data-testid="form-field"
    >
      <span className="nx-td-grip" aria-hidden><TdIcon name="drag" size={16} stroke={3} /></span>
      {/* The keyboard way to select a field is this button. The row
          used to be role="button" itself, wrapping its own move and
          remove buttons — nested controls a screen reader cannot
          reach (axe nested-interactive). */}
      <button type="button" className="nx-td-field-main" aria-pressed={item.id === selected} onClick={(event) => { event.stopPropagation(); setSelected(item.id); }}>
        <b>{item.label}{item.required ? " *" : ""}</b>
        <small>
          {TYPE_LABEL[item.type]}
          {whereItGoes(item, target)}
          {whenShown(item, fields)}
        </small>
      </button>
      {editable && (
        <Space size={2}>
          <Button type="text" aria-label={`Move ${item.label || "this field"} up`} disabled={position === 0} onClick={(e) => { e.stopPropagation(); onFields(moved(fields, position, position - 1)); }} icon={<TdIcon name="up" />} />
          <Button type="text" aria-label={`Remove ${item.label || "this field"}`} onClick={(e) => { e.stopPropagation(); onFields(fields.filter((f) => f.id !== item.id)); if (selected === item.id) setSelected(null); }} icon={<TdIcon name="x" />} />
        </Space>
      )}
    </div>
  );
}

/** Where an answer is written: a field of the record, or kept with the submission. */
function whereItGoes(item: FormField, target?: FormTarget): string {
  if (item.map_to) return ` → ${target?.fields.find((f) => f.name === item.map_to)?.label ?? item.map_to}`;
  return item.type !== "heading" ? " · kept with the submission" : "";
}

/** The condition a field is shown under, if it has one. */
function whenShown(item: FormField, fields: FormField[]): string {
  if (!item.visible_when) return "";
  const on = fields.find((f) => f.id === item.visible_when?.field)?.label ?? "…";
  return ` · only when ${on} is ${asText(item.visible_when.equals) || "answered"}`;
}
