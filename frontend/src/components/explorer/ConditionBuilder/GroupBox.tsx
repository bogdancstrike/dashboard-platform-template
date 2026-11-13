import { type ReactNode } from "react";
import { Checkbox, Dropdown, Tooltip } from "antd";

import { appendChild, children, conjunctionOf, isGroup, isNot, newGroup, newRule } from "../conditionTree";
import { FdIcon } from "@/components/icons/FdIcon";
import type { QueryNode } from "../queryTree";

import { moveItems } from "./moveItems";
import { RuleRow } from "./RuleRow";
import type { Ctx } from "./context";

/**
 * One group, as a box: a header line — **All of / Any of**, a **Not** box, and
 * on the right **+ Condition**, **Group** and (nested) a red bin — then one
 * row per condition or nested group. Nested groups are inset boxes with a
 * faint tint that deepens a step per level. Every row and group has a grip on
 * hover: drag it to reorder, or into another group (§4).
 */
export function GroupBox({ node, depth, parent, index = 0, ctx, extraAdd }: {
  node: QueryNode;
  depth: number;
  parent?: QueryNode;
  index?: number;
  ctx: Ctx;
  extraAdd?: ReactNode;
}) {
  const id = node.id as string;
  const root = depth === 0;
  const conj = conjunctionOf(node);
  const not = isNot(node);
  const items = children(node);
  const setConj = (next: "AND" | "OR") => ctx.dispatch({ type: "setGroup", id, patch: { conjunction: next } });
  const addRule = () => ctx.dispatch({ type: "add", group: id, node: newRule() });
  const addGroup = () => {
    const group = newGroup(conj === "AND" ? "OR" : "AND");
    ctx.dispatch({ type: "add", group: id, node: appendChild(group, group.id as string, newRule()) });
  };
  const dropHere = (position: number) => ctx.drop?.group === id && ctx.drop.index === position;

  const moreMenu = root
    ? [{ key: "clear", label: "Remove every condition", danger: true, disabled: items.length === 0, onClick: () => ctx.dispatch({ type: "clear", id }) }]
    : [
        ...moveItems(ctx, parent, id, index),
        { key: "dup", label: "Duplicate this group", onClick: () => ctx.dispatch({ type: "duplicate", id }) },
      ];

  return (
    <section
      className={`nx-fd-cb-group${root ? " is-root" : ""}${not ? " is-not" : ""}`}
      aria-label={root ? "Root group" : "Group"}
      data-depth={Math.min(depth, 4)}
    >
      <div className="nx-fd-cb-ghead">
        <div className="nx-fd-cb-seg" role="group" aria-label={`${root ? "Root group" : "Group"}: match all or any`}>
          {(["AND", "OR"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={conj === option}
              className={conj === option ? "is-on" : ""}
              {...(conj !== option ? { "data-testid": "conj-toggle" } : {})}
              onClick={() => setConj(option)}
            >
              {option === "AND" ? "All of" : "Any of"}
            </button>
          ))}
        </div>
        <Checkbox
          className="nx-fd-cb-notbox"
          checked={not}
          onChange={(event) => ctx.dispatch({ type: "setGroup", id, patch: { not: event.target.checked } })}
        >
          Not
        </Checkbox>
        <span className="nx-fd-push" />
        <button type="button" className="nx-fd-cb-pillbtn" aria-label="Add a condition" onClick={addRule}>
          <FdIcon name="plus" size={13} strokeWidth={2.4} /> <span className="nx-fd-cb-pilltext">Condition</span>
        </button>
        {depth < 3 && (
          <button type="button" className="nx-fd-cb-pillbtn" aria-label="Add a group" onClick={addGroup}>
            <FdIcon name="branch" size={13} /> <span className="nx-fd-cb-pilltext">Group</span>
          </button>
        )}
        {root && extraAdd}
        {moreMenu.length > 0 && (
          <Dropdown menu={{ items: moreMenu }} trigger={["click"]} placement="bottomRight">
            <button type="button" className="nx-fd-cb-icon nx-fd-cb-hover" aria-label={root ? "Root group options" : "Group options"}>
              <FdIcon name="dots" size={15} strokeWidth={3} />
            </button>
          </Dropdown>
        )}
        {!root && (
          <Tooltip title="Remove this group and everything in it">
            <button type="button" className="nx-fd-cb-icon is-danger" aria-label="Remove this group" onClick={() => ctx.dispatch({ type: "remove", id })}>
              <FdIcon name="trash" size={15} />
            </button>
          </Tooltip>
        )}
      </div>

      {items.map((child, position) => {
        const childId = child.id as string;
        return (
          <div
            className={`nx-fd-cb-line${dropHere(position) ? " is-drop-before" : ""}${
              position === items.length - 1 && dropHere(items.length) ? " is-drop-after" : ""
            }${ctx.drag === childId ? " is-dragged" : ""}`}
            key={childId}
            data-node={childId}
            onDragOver={(event) => {
              if (!ctx.drag) return;
              // The innermost line under the pointer decides.
              event.stopPropagation();
              const box = event.currentTarget.getBoundingClientRect();
              const after = event.clientY > box.top + box.height / 2;
              if (ctx.over(id, after ? position + 1 : position)) event.preventDefault();
            }}
            onDrop={(event) => {
              if (!ctx.drag) return;
              event.preventDefault();
              event.stopPropagation();
              ctx.land();
            }}
          >
            <button
              type="button"
              className="nx-fd-cb-grip"
              draggable
              aria-label={`Drag to move this ${isGroup(child) ? "group" : "rule"}`}
              title="Drag to move — or use ⋯ › Move up / Move down"
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", childId);
                const line = (event.currentTarget as HTMLElement).closest(".nx-fd-cb-line");
                if (line) event.dataTransfer.setDragImage(line, 12, 18);
                ctx.startDrag(childId);
              }}
              onDragEnd={ctx.endDrag}
            >
              <FdIcon name="drag" size={13} strokeWidth={3.2} />
            </button>
            {isGroup(child) ? (
              <GroupBox node={child} depth={depth + 1} parent={node} index={position} ctx={ctx} />
            ) : (
              <RuleRow node={child} parent={node} index={position} ctx={ctx} />
            )}
          </div>
        );
      })}

      {/* A drop target after the last row, and the place an empty group says so. */}
      <div
        className={`nx-fd-cb-tail${items.length === 0 && dropHere(0) ? " is-drop-before" : ""}`}
        onDragOver={(event) => {
          if (!ctx.drag) return;
          event.stopPropagation();
          if (ctx.over(id, items.length)) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!ctx.drag) return;
          event.preventDefault();
          event.stopPropagation();
          ctx.land();
        }}
      >
        {items.length === 0 && <span className="nx-fd-muted nx-fd-small">No conditions — every record matches.</span>}
      </div>
    </section>
  );
}
