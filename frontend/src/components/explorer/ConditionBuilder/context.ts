import type { ExplorerField } from "@/api/explorer";

import type { ConditionAction } from "../conditionTree";
import type { QueryNode } from "../queryTree";

/** What every node of the builder shares: the tree, the fields, the edit dispatch and the drag in progress. */
export interface Ctx {
  tree: QueryNode;
  fields: ExplorerField[];
  byName: Map<string, ExplorerField>;
  /** Apply one edit to the tree and hand the result upward. */
  dispatch: (action: ConditionAction) => void;
  /** The node being dragged, and where it would land. */
  drag: string | null;
  drop: { group: string; index: number } | null;
  startDrag: (id: string) => void;
  endDrag: () => void;
  /** Propose a landing place; false when it is not allowed there. */
  over: (group: string, index: number) => boolean;
  land: () => void;
}
