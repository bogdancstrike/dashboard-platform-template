/** The report builder's vocabulary: block kinds, paper, and how a block is described in the outline. */

import type { DocumentBlock } from "@/api/reportDocuments";
import { BLOCK_SPECS } from "@/components/documents/blocks";

/** What one block is about, in the outline. */
export function describe(block: DocumentBlock, reports: { id: string; name: string }[]): string {
  if (block.kind === "HEADING" || block.kind === "TEXT") {
    const text = (block.text ?? "").trim();
    return text ? text.slice(0, 60) : "Empty";
  }
  if (block.kind === "REPORT") {
    return reports.find((report) => report.id === block.report_id)?.name ?? "No report chosen";
  }
  // A caption is the author's own name for the block; the key-based fallback
  // read "ticket by created_at" (audit A).
  const caption = "caption" in block ? (block.caption ?? "").trim() : "";
  const human = (key: string) => key.replace(/_/g, " ");
  if (block.kind === "TABLE" || block.kind === "METRICS") {
    return caption || (block.entity ? human(block.entity) : "No dataset chosen");
  }
  // The question, not the kind: an outline of four charts all reading "Group a
  // dataset and draw it" is an outline nobody navigates by.
  if (block.kind === "CHART") {
    if (!block.entity) return "No dataset chosen";
    if (caption) return caption;
    return block.dimension
      ? `${human(block.entity)} by ${human(block.dimension)}`
      : human(block.entity);
  }
  return BLOCK_SPECS[block.kind].hint;
}
