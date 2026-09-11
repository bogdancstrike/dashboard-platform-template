/**
 * What each block of a report document *is*, in one place (§28).
 *
 * The add menu, the outline and the settings rail all need the same three
 * facts about a block — what to call it, what it is for, and how to draw it
 * small. Three copies of that list is three places to forget a kind, and the
 * one that forgets it is the one somebody uses.
 *
 * The record is keyed on the whole `BlockKind` union, so a kind added to the
 * server without being described here fails to compile rather than appearing
 * in a document as an unlabelled row.
 */

import {
  AreaChartOutlined,
  BarChartOutlined,
  BorderHorizontalOutlined,
  ColumnHeightOutlined,
  FileTextOutlined,
  FontSizeOutlined,
  NumberOutlined,
  ScissorOutlined,
  TableOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

import type { BlockKind, DocumentBlock } from "@/api/reportDocuments";

export interface BlockSpec {
  label: string;
  /** What it is for, in the words somebody would use asking for it. */
  hint: string;
  icon: ReactNode;
}

export const BLOCK_SPECS: Record<BlockKind, BlockSpec> = {
  HEADING: {
    label: "Heading",
    hint: "A section title, at one of three levels.",
    icon: <FontSizeOutlined />,
  },
  TEXT: {
    label: "Paragraph",
    hint: "Your own words — what the numbers mean, and what to do about them.",
    icon: <FileTextOutlined />,
  },
  CHART: {
    label: "Chart",
    hint: "Group a dataset and draw it — any picture the chart builder can.",
    icon: <AreaChartOutlined />,
  },
  REPORT: {
    label: "A saved report",
    hint: "One you already built, run afresh each time the file is written.",
    icon: <BarChartOutlined />,
  },
  TABLE: {
    label: "Rows",
    hint: "Records straight from a dataset, in the order you choose.",
    icon: <TableOutlined />,
  },
  METRICS: {
    label: "Headline numbers",
    hint: "A dataset's own declared figures, across the page.",
    icon: <NumberOutlined />,
  },
  DIVIDER: {
    label: "Rule",
    hint: "A line between two sections.",
    icon: <BorderHorizontalOutlined />,
  },
  SPACER: {
    label: "Space",
    hint: "Room to breathe, in three sizes.",
    icon: <ColumnHeightOutlined />,
  },
  PAGE_BREAK: {
    label: "Page break",
    hint: "Start the next section on a new page.",
    icon: <ScissorOutlined />,
  },
};

/** The order the add menu offers them: words first, then data, then furniture. */
export const BLOCK_ORDER: BlockKind[] = [
  "HEADING",
  "TEXT",
  "CHART",
  "REPORT",
  "TABLE",
  "METRICS",
  "DIVIDER",
  "SPACER",
  "PAGE_BREAK",
];

/**
 * A new block of a kind, with an id nothing else on the document is using.
 *
 * Ids are generated here rather than by the server because a block has to be
 * addressable *before* it is saved: the outline selects one, the settings rail
 * edits it, and the chart register keys its captured image by it. A counter
 * past the highest existing number, so reordering and deleting cannot produce
 * a collision the way `blocks.length + 1` eventually does.
 */
export function newBlock(kind: BlockKind, existing: DocumentBlock[]): DocumentBlock {
  const highest = existing.reduce((top, block) => {
    const match = /^b(\d+)$/.exec(block.id);
    return match ? Math.max(top, Number(match[1])) : top;
  }, 0);
  const id = `b${highest + 1}`;

  switch (kind) {
    case "HEADING":
      return { id, kind, text: "New section", level: 2 };
    case "TEXT":
      return { id, kind, text: "" };
    case "SPACER":
      return { id, kind, size: "medium" };
    case "CHART":
      // Counting rows is the only measure every dataset can answer, so it is
      // the default: a block that needed a numeric column chosen before it
      // could draw anything would open as an error.
      return {
        id,
        kind,
        chart: "bar",
        aggregation: "count",
        show: "chart",
        caption: "",
        filters: {},
      };
    case "REPORT":
      return { id, kind, show: "both", caption: "" };
    case "TABLE":
      return { id, kind, order: "desc", limit: 20, caption: "", filters: {} };
    case "METRICS":
      return { id, kind, caption: "", filters: {} };
    default:
      return { id, kind };
  }
}
