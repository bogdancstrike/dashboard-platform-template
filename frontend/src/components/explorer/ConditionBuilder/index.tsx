/**
 * The condition builder of the Data Explorer (§4) — rules and nested AND / OR
 * groups, drawn the way the glass design draws them: a root card, rules as
 * white pill rows, nested groups as tinted brackets with a coloured rail, the
 * connective printed between every pair of siblings.
 *
 * It edits the same JSON tree react-awesome-query-builder exports, so saved
 * searches, URLs and the server's `compile_tree` are untouched by the swap; the
 * library editor is still what the automation wizard uses. The tree is owned
 * here while it is edited and handed upward on every change — the parent owns
 * the draft, so a half-built rule is just a rule the server skips.
 *
 * The controls keep the class names the end-to-end helpers locate
 * (`rule--field`, `rule--operator`, `rule--value`) and the names they press
 * ("Add rule", "Or", "Not", "Duplicate this rule").
 */

import { useMemo, useState, type ReactNode } from "react";

import type { ExplorerField } from "@/api/explorer";

import { containsId, findById, moveNode, normalise } from "../conditionTree";
import { conditionReducer } from "../conditionTree";
import type { QueryNode } from "../queryTree";

import { GroupBox } from "./GroupBox";
import type { Ctx } from "./context";

export interface ConditionBuilderProps {
  fields: ExplorerField[];
  value: QueryNode | null;
  onChange: (tree: QueryNode) => void;
  /** Extra controls at the end of the root's add row ("Add from a saved search"). */
  extraAdd?: ReactNode;
}

export { fieldIcon, fieldKindLabel, humanise } from "./fieldMeta";

export function ConditionBuilder({ fields, value, onChange, extraAdd }: ConditionBuilderProps) {
  const tree = useMemo(() => normalise(value), [value]);
  const filterable = useMemo(() => fields.filter((field) => field.filterable), [fields]);
  const byName = useMemo(() => new Map(fields.map((field) => [field.name, field] as const)), [fields]);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ group: string; index: number } | null>(null);

  const ctx: Ctx = {
    tree,
    fields: filterable,
    byName,
    dispatch: (action) => onChange(conditionReducer(tree, action)),
    drag,
    drop,
    startDrag: (id) => setDrag(id),
    endDrag: () => {
      setDrag(null);
      setDrop(null);
    },
    over: (group, index) => {
      // A group cannot be dropped into itself or anything inside it.
      const dragged = drag ? findById(tree, drag) : null;
      if (!dragged || containsId(dragged, group)) return false;
      setDrop((current) => (current?.group === group && current.index === index ? current : { group, index }));
      return true;
    },
    land: () => {
      if (drag && drop) onChange(moveNode(tree, drag, drop.group, drop.index));
      setDrag(null);
      setDrop(null);
    },
  };

  return (
    <div className={`nx-fd-cb${drag ? " is-dragging" : ""}`} aria-label="Advanced query builder">
      <GroupBox node={tree} depth={0} ctx={ctx} extraAdd={extraAdd} />
    </div>
  );
}
