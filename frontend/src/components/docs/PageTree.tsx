/**
 * A space's pages as a tree (§48), dragged to reorder or nest.
 *
 * A drop *onto* a page nests under it; a drop *between* two pages lands beside
 * them, which the server turns into a midpoint position — one row written per
 * drag. The server refuses a page dropped inside its own branch, and the tree
 * says so rather than losing the branch.
 */

import { Tree, type TreeDataNode, type TreeProps } from "antd";
import { useMemo } from "react";

import type { TreeItem } from "@/api/docs";

export interface MoveRequest {
  id: string;
  parent_id: string | null;
  before_id?: string;
  after_id?: string;
}

export function buildTree(items: TreeItem[]): TreeDataNode[] {
  const children = new Map<string | null, TreeItem[]>();
  for (const item of items) {
    const key = item.parent_id && items.some((other) => other.id === item.parent_id) ? item.parent_id : null;
    children.set(key, [...(children.get(key) ?? []), item]);
  }
  const make = (parent: string | null): TreeDataNode[] =>
    (children.get(parent) ?? [])
      .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
      .map((item) => ({
        key: item.id,
        title: (
          <span className="nx-dc-node" data-testid={`tree-${item.title}`}>
            <span aria-hidden className="nx-dc-node-icon">{item.icon ?? (item.is_meeting ? "🗓️" : "📄")}</span>
            <span className="nx-dc-node-title">{item.title}</span>
          </span>
        ),
        children: make(item.id),
        isLeaf: !children.has(item.id),
      }));
  return make(null);
}

/** Turn antd's drop event into the server's move request. */
export function moveFromDrop(info: Parameters<NonNullable<TreeProps["onDrop"]>>[0], items: TreeItem[]): MoveRequest {
  const dragged = String(info.dragNode.key);
  const target = String(info.node.key);
  if (!info.dropToGap) return { id: dragged, parent_id: target };
  const targetItem = items.find((item) => item.id === target);
  const parent = targetItem?.parent_id ?? null;
  const position = info.node.pos.split("-");
  const relative = info.dropPosition - Number(position[position.length - 1]);
  return relative < 0
    ? { id: dragged, parent_id: parent, before_id: target }
    : { id: dragged, parent_id: parent, after_id: target };
}

export function PageTree({
  items,
  selected,
  canEdit,
  onOpen,
  onMove,
}: {
  items: TreeItem[];
  selected?: string;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onMove: (move: MoveRequest) => void;
}) {
  const data = useMemo(() => buildTree(items), [items]);
  const expanded = useMemo(() => {
    // Open the branch the selected page is in, and every top-level page.
    const open = new Set<string>(items.filter((item) => !item.parent_id).map((item) => item.id));
    let cursor = items.find((item) => item.id === selected);
    while (cursor?.parent_id) {
      open.add(cursor.parent_id);
      cursor = items.find((item) => item.id === cursor!.parent_id);
    }
    return [...open];
  }, [items, selected]);

  return (
    <Tree
      className="nx-dc-tree"
      blockNode
      draggable={canEdit ? { icon: false } : false}
      treeData={data}
      selectedKeys={selected ? [selected] : []}
      defaultExpandedKeys={expanded}
      key={`${selected ?? ""}-${items.length}`}
      onSelect={(keys) => keys[0] && onOpen(String(keys[0]))}
      onDrop={(info) => onMove(moveFromDrop(info, items))}
    />
  );
}
