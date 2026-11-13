/**
 * The field types a form can hold — a registry the palette, the new-field
 * defaults and the inspector all read.
 *
 * A type's entry says what it is called, what it starts with, and which of the
 * inspector's controls apply to it; adding a type is one entry here rather than
 * a condition in each of three places.
 */
import type { ComponentType } from "react";
import { Input, InputNumber } from "antd";

import type { FieldType, FormDetail, FormField } from "@/api/forms";

export interface FieldEditorProps {
  field: FormField;
  editable: boolean;
  update: (patch: Partial<FormField>) => void;
}

export interface FieldTypeSpec {
  type: FieldType;
  label: string;
  hint: string;
  /** What a new field of this type starts with beyond its label. */
  defaults?: () => Partial<FormField>;
  /** Whether the inspector offers a placeholder. */
  placeholder?: boolean;
  /** Whether its answer can be written to a field of the record (a file cannot). */
  mappable?: boolean;
  /** A heading only labels a section: no help, required, or mapping. */
  structural?: boolean;
  /** The inspector's controls specific to this type. */
  Editor?: ComponentType<FieldEditorProps>;
}

function OptionsEditor({ field, editable, update }: FieldEditorProps) {
  return (
    <label>Options, one per line
      <Input.TextArea rows={4} disabled={!editable} value={(field.options ?? []).join("\n")} onChange={(e) => update({ options: e.target.value.split("\n") })} aria-label="Options" />
    </label>
  );
}

function StarsEditor({ field, editable, update }: FieldEditorProps) {
  return (
    <label>Stars<InputNumber min={3} max={10} value={field.max ?? 5} disabled={!editable} onChange={(max) => update({ max: Number(max) || 5 })} style={{ width: "100%" }} /></label>
  );
}

const CHOICES = () => ({ options: ["Option one", "Option two"] });

export const FIELD_TYPES: FieldTypeSpec[] = [
  { type: "text", label: "Short text", hint: "One line", placeholder: true, mappable: true },
  { type: "textarea", label: "Long text", hint: "Paragraphs", placeholder: true, mappable: true },
  { type: "email", label: "Email", hint: "Checked address", placeholder: true, mappable: true },
  { type: "number", label: "Number", hint: "Digits only", placeholder: true, mappable: true },
  { type: "select", label: "Choice", hint: "Pick one", defaults: CHOICES, mappable: true, Editor: OptionsEditor },
  { type: "multiselect", label: "Multiple choice", hint: "Pick several", defaults: CHOICES, mappable: true, Editor: OptionsEditor },
  { type: "date", label: "Date", hint: "Calendar", mappable: true },
  { type: "file", label: "File upload", hint: "Up to 3 MB" },
  { type: "rating", label: "Rating", hint: "Stars", defaults: () => ({ max: 5 }), mappable: true, Editor: StarsEditor },
  { type: "heading", label: "Section heading", hint: "Splits the form", structural: true, mappable: true },
];

const SPECS = Object.fromEntries(FIELD_TYPES.map((item) => [item.type, item])) as Record<FieldType, FieldTypeSpec>;

export function fieldSpec(type: FieldType): FieldTypeSpec {
  return SPECS[type];
}

export const TYPE_LABEL = Object.fromEntries(FIELD_TYPES.map((item) => [item.type, item.label])) as Record<FieldType, string>;

/** The form a new design starts from: three fields every intake needs. */
export const BLANK: FormDetail = {
  id: "", name: "New intake form", slug: "", description: "", target: "ticket", status: "DRAFT",
  visibility: "PUBLIC", submission_count: 0, owner: null, public_path: "", updated_at: null, created_at: null,
  field_count: 0, fields: [
    { id: "email", type: "email", label: "Your email", required: true },
    { id: "subject", type: "text", label: "What do you need?", required: true, map_to: "subject" },
    { id: "details", type: "textarea", label: "Details", map_to: "description" },
  ],
  settings: {
    visibility: "PUBLIC", confirmation: "Thank you — we have received your request.", notify_user_ids: [],
    captcha: true, rate_limit_per_hour: 10, defaults: {}, submit_label: "Send",
  },
  targets: [], can_manage: true,
};

export function newField(type: FieldType, existing: FormField[]): FormField {
  let n = existing.length + 1;
  while (existing.some((field) => field.id === `${type}${n}`)) n += 1;
  return { id: `${type}${n}`, type, label: TYPE_LABEL[type], required: false, ...SPECS[type].defaults?.() };
}

/** Move one item in a list to a new position — the drag-and-drop's whole arithmetic. */
export function moved<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(Math.max(0, Math.min(copy.length, to)), 0, item!);
  return copy;
}
