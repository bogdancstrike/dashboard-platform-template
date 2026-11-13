import { children } from "../conditionTree";
import type { QueryNode } from "../queryTree";

import type { Ctx } from "./context";

/** "Move up" / "Move down" / "Move out" menu items — the keyboard's drag and drop. */
export function moveItems(ctx: Ctx, parent: QueryNode | undefined, id: string, index: number) {
  if (!parent) return [];
  const count = children(parent).length;
  const parentId = parent.id as string;
  const grand = parentId === ctx.tree.id ? null : findParent(ctx.tree, parentId);
  return [
    { key: "up", label: "Move up", disabled: index === 0, onClick: () => ctx.dispatch({ type: "moveWithin", group: parentId, id, index: index - 1 }) },
    { key: "down", label: "Move down", disabled: index >= count - 1, onClick: () => ctx.dispatch({ type: "moveWithin", group: parentId, id, index: index + 1 }) },
    ...(grand
      ? [{
          key: "out",
          label: "Move out of this group",
          onClick: () => {
            const at = children(grand).findIndex((child) => child.id === parentId);
            ctx.dispatch({ type: "move", id, group: grand.id as string, index: at + 1 });
          },
        }]
      : []),
  ];
}

export function findParent(tree: QueryNode, id: string): QueryNode | null {
  for (const child of children(tree)) {
    if (child.id === id) return tree;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}
