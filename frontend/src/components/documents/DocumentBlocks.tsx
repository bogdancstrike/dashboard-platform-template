/**
 * What each block of a report document is, and what it looks like on paper
 * (§28).
 *
 * Split from the page for the same reason `WidgetBody` is split from
 * `WidgetCard`: this follows the *endpoints that answer each block*, and the
 * builder around it follows the layout. One file that did both would change
 * for two reasons.
 *
 * **The preview is the document, not an impression of it.** A `REPORT` block
 * runs the saved report through the same compiler the chart builder previews
 * with; a `TABLE` block runs the explorer query every list uses; a `METRICS`
 * block reads the dataset's declared insights. The server resolves the same
 * three questions when it renders the file, which is what makes "what you see
 * is what you export" true rather than aspirational.
 *
 * **A chart hands back its own PNG.** There is no chart engine on the server,
 * so the export carries the picture this component already drew. The instance
 * is registered by block id when the chart is ready and unregistered when it
 * goes; the builder reads the register at the moment somebody presses Export.
 */

import { BLOCK_PREVIEWS, type BlockPreviewProps } from "./previews/registry";

export type { Capturable } from "./previews/shared";

/** One block as it will appear on paper, drawn by its kind's entry in the registry. */
export function BlockPreview(props: BlockPreviewProps) {
  const preview = BLOCK_PREVIEWS[props.block.kind] as PreviewEntry | undefined;
  return <>{preview ? preview(props) : null}</>;
}

type PreviewEntry = (typeof BLOCK_PREVIEWS)[keyof typeof BLOCK_PREVIEWS];
