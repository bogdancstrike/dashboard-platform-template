import dayjs from "dayjs";

import { type ExplorerField, type ExplorerResource } from "@/api/explorer";
import { type RecordChanges, type RecordField } from "@/api/records";

/** The declaration one control is built from, whichever endpoint published it. */
/** Paragraphs and documents take the form's full width; everything else half. */
export function wide(field: EditableField): boolean {
  return field.prose || field.kind === "json" || field.kind === "array";
}

export interface EditableField {
  name: string;
  label: string;
  kind: RecordField["kind"];
  choices: string[];
  required: boolean;
  minimum: number | null;
  maximum: number | null;
  references: string;
  /** Rendered as a paragraph box rather than one line. */
  prose: boolean;
}

/**
 * A reference field picks a person or a record, so its label names the thing:
 * "Account manager", not the column "Account manager ID" — which also leaked
 * into the placeholder as "Search people for account manager id".
 */
export function referenceLabel(label: string, references: string): string {
  return references ? label.replace(/\s+id$/i, "") : label;
}

/**
 * The writable fields of a record, merged with the vocabulary the catalogue
 * publishes.
 *
 * Both halves are needed and neither is enough: the record says which fields
 * may be written and what they currently hold, and the catalogue says which
 * values an enum allows. Reading choices off the record would mean an edit
 * form whose status select is empty for a status nobody has used yet.
 */
export function editableFields(
  resource: ExplorerResource | undefined,
  fields: RecordField[],
  contentFields: string[] = [],
): EditableField[] {
  const declared = new Map<string, ExplorerField>(
    (resource?.fields ?? []).map((field) => [field.name, field]),
  );
  return fields
    .filter((field) => field.editable)
    .map((field) => ({
      name: field.name,
      label: referenceLabel(field.label, field.references ?? declared.get(field.name)?.references ?? ""),
      kind: field.kind,
      choices: declared.get(field.name)?.choices ?? [],
      required: Boolean(field.required),
      minimum: field.minimum ?? null,
      maximum: field.maximum ?? null,
      references: field.references ?? declared.get(field.name)?.references ?? "",
      prose: contentFields.includes(field.name),
    }));
}

/** The same list, for a record that does not exist yet (§9 — create). */
export function creatableFields(resource: ExplorerResource | undefined): EditableField[] {
  return (resource?.fields ?? [])
    .filter((field) => field.editable)
    .map((field) => ({
      name: field.name,
      label: referenceLabel(field.label, field.references ?? ""),
      kind: field.kind,
      choices: field.choices,
      required: Boolean(field.required),
      minimum: field.minimum ?? null,
      maximum: field.maximum ?? null,
      references: field.references ?? "",
      prose: false,
    }));
}

/**
 * Which values actually travel.
 *
 * Only the fields this reader touched: a payload carrying every rendered field
 * would overwrite the ones somebody else moved while the drawer was open.
 */
export function onlyChanged(
  values: Record<string, unknown>,
  initial: Record<string, unknown>,
  fields: EditableField[],
): RecordChanges {
  const changes: RecordChanges = {};
  for (const field of fields) {
    const next = wireValue(values[field.name]);
    const before = wireValue(initial[field.name]);
    // Compared as JSON, not by identity: a `json` field holds an array, and
    // two arrays are never `===` — so an untouched checklist would travel on
    // every save and overwrite whatever somebody else had ticked meanwhile.
    if (JSON.stringify(next) !== JSON.stringify(before)) changes[field.name] = next;
  }
  return changes;
}

/** A control's value as the API reads it: ISO for dates, null for empty. */
export function wireValue(value: unknown): unknown {
  if (value === undefined || value === "" || value === null) return null;
  if (dayjs.isDayjs(value)) return value.toISOString();
  return value;
}

export function singular(label: string | undefined): string {
  return (label ?? "record").replace(/s$/, "").toLowerCase();
}
