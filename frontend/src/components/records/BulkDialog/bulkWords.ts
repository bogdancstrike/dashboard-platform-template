import type { BulkAction } from "@/api/bulk";
import type { ExplorerField, ExplorerResource } from "@/api/explorer";
import { formatNumber } from "@/lib/formats";

/** The fields a bulk edit offers: a closed vocabulary, and nothing else. */
export function settableFields(resource: ExplorerResource | undefined): ExplorerField[] {
  return (resource?.fields ?? []).filter(
    (field) => field.editable && field.kind === "enum" && field.choices.length > 0,
  );
}

/** What the confirm button says, so it names the act rather than agreeing to it. */
export function confirmLabel(
  action: BulkAction,
  eligible: number,
  resource: ExplorerResource | undefined,
): string {
  const noun = eligible === 1 ? singular(resource) : (resource?.label ?? "records").toLowerCase();
  return `${action === "delete" ? "Delete" : "Update"} ${formatNumber(eligible)} ${noun}`;
}

export function singular(resource: ExplorerResource | undefined): string {
  return (resource?.label ?? "record").replace(/s$/, "").toLowerCase();
}
