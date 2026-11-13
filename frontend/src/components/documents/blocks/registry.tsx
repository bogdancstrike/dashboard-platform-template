/**
 * The report-document block registry: how each block kind previews (§28).
 *
 * Keyed on the whole `BlockKind` union, so a kind the server adds without a
 * preview here fails to compile rather than leaving a gap in the document.
 * The data kinds draw from the endpoint that answers them; the layout kinds
 * are drawn in place.
 */

import type { ReactNode } from "react";
import { Typography } from "antd";

import type { BlockKind, DocumentBlock } from "@/api/reportDocuments";
import type { ExplorerResource } from "@/api/explorer";

import { ChartBlock } from "./ChartBlock";
import { MetricsBlock } from "./MetricsBlock";
import { ReportBlock } from "./ReportBlock";
import type { Capturable } from "./shared";
import { TableBlock } from "./TableBlock";

const { Text, Title, Paragraph } = Typography;

export interface BlockPreviewProps {
  block: DocumentBlock;
  resources: ExplorerResource[];
  /** Register the drawn chart against this block, for the export. */
  onChart: (id: string, chart: Capturable) => void;
}

export const BLOCK_PREVIEWS: Record<BlockKind, (props: BlockPreviewProps) => ReactNode> = {
  HEADING: ({ block }) => (
    <Title level={(block.level ?? 2) as 1 | 2 | 3} className="nu-doc-heading">
      {block.text || "Untitled heading"}
    </Title>
  ),
  TEXT: ({ block }) => (
    <Paragraph className="nu-doc-text">
      {block.text || (
        <Text type="secondary" italic>
          Empty paragraph — write something, or remove the block.
        </Text>
      )}
    </Paragraph>
  ),
  DIVIDER: () => <hr className="nu-doc-rule" />,
  SPACER: ({ block }) => (
    <div className={`nu-doc-spacer is-${block.size ?? "medium"}`} aria-hidden />
  ),
  // Drawn as a marked break rather than as an actual new sheet: the preview
  // is a continuous column, and a reader needs to know a break is *there* far
  // more than they need the scroll to jump.
  PAGE_BREAK: () => (
    <div className="nu-doc-break" aria-label="Page break">
      <span>page break</span>
    </div>
  ),
  CHART: ({ block, onChart }) => <ChartBlock block={block} onChart={onChart} />,
  REPORT: ({ block, onChart }) => <ReportBlock block={block} onChart={onChart} />,
  TABLE: ({ block, resources }) => <TableBlock block={block} resources={resources} />,
  METRICS: ({ block }) => <MetricsBlock block={block} />,
};
