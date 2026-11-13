import type { ExplorerField } from "@/api/explorer";

import { type FdIconName } from "@/components/icons/FdIcon";

export const DATE_FORMAT = "YYYY-MM-DD HH:mm:ss";

export function fieldIcon(field?: ExplorerField): FdIconName {
  if (!field) return "text";
  if (field.references) return "rel";
  switch (field.kind) {
    case "enum":
      return "enum";
    case "datetime":
      return "date";
    case "number":
      return "number";
    case "bool":
      return "bool";
    case "array":
      return "tag";
    default:
      return "text";
  }
}

export function fieldKindLabel(field?: ExplorerField): string {
  if (!field) return "Field";
  if (field.references) return "Relation";
  return { enum: "Choice", datetime: "Date", number: "Number", bool: "Yes / no", array: "Tags", text: "Text", uuid: "Id", json: "Data" }[field.kind] ?? "Text";
}

/** `IN_PROGRESS` is a database value; `In progress` is what a person reads. */
export function humanise(value: string): string {
  const spaced = String(value).replaceAll("_", " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
