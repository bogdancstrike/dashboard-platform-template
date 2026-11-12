/**
 * The question on screen, read back as a row of chips (§4, §69).
 *
 * "WHERE Status is Offline AND Last seen more than 24 h AND ( Firmware … OR … )"
 * — rules as white pills, groups as tinted brackets, NOT groups in red, the
 * connective between every pair. Read-only: the chips say what was asked, and
 * the builder is where it is changed. A rule the server skips (no value yet) is
 * not shown, because it is not part of the answer.
 */

import { Fragment, type ReactNode } from "react";

import type { ExplorerField } from "@/api/explorer";

import { humanise } from "./ConditionBuilder";
import {
  MULTI_VALUE,
  NO_VALUE,
  children,
  conjunctionOf,
  incompleteReason,
  isGroup,
  isNot,
  ruleParts,
} from "./conditionTree";
import { operatorWords } from "./conditionTree";
import type { QueryNode } from "./queryTree";

function valueText(field: ExplorerField | undefined, operator: string, value: unknown[]): { text: string; mono: boolean } {
  if (NO_VALUE.has(operator)) return { text: "", mono: false };
  const show = (item: unknown) => (field?.kind === "enum" ? humanise(String(item)) : String(item));
  if (MULTI_VALUE.has(operator)) {
    const list = Array.isArray(value[0]) ? (value[0] as unknown[]) : [];
    return { text: list.map(show).join(", "), mono: field?.kind !== "enum" };
  }
  if (operator === "between") return { text: `${show(value[0])} – ${show(value[1])}`, mono: false };
  const single = value[0];
  if (field?.kind === "text" || field?.kind === "uuid") return { text: `“${String(single)}”`, mono: true };
  if (field?.kind === "bool") return { text: single ? "yes" : "no", mono: false };
  if (field?.kind === "datetime") return { text: String(single).slice(0, 16).replace("T", " "), mono: false };
  return { text: show(single), mono: false };
}

function visible(node: QueryNode): boolean {
  if (isGroup(node)) return children(node).some(visible);
  return !incompleteReason(node);
}

export function ConditionChips({ tree, fields, lead = "Where", extra }: {
  tree: QueryNode | null | undefined;
  fields: ExplorerField[];
  lead?: string;
  /** Chips for the simple filters and the search term, appended at the end. */
  extra?: ReactNode;
}) {
  const byName = new Map(fields.map((field) => [field.name, field] as const));
  const hasTree = Boolean(tree && visible(tree));
  if (!hasTree && !extra) return null;

  const renderRule = (node: QueryNode) => {
    const { field: name, operator, value } = ruleParts(node);
    const field = byName.get(name);
    const shown = valueText(field, operator, value);
    return (
      <span className="nx-fd-chiprule" key={node.id}>
        <b>{field?.label ?? name}</b>
        <span className="nx-fd-chipop">{operatorWords(operator, field?.kind)}</span>
        {shown.text && <b className={shown.mono ? "nx-fd-mono" : ""}>{shown.text}</b>}
      </span>
    );
  };

  const renderList = (group: QueryNode): ReactNode[] => {
    const conj = conjunctionOf(group);
    return children(group)
      .filter(visible)
      .map((child, index) => (
        <Fragment key={child.id ?? index}>
          {index > 0 && <span className={`nx-fd-chipconj${conj === "OR" ? " is-or" : ""}`}>{conj}</span>}
          {isGroup(child) ? renderGroup(child) : renderRule(child)}
        </Fragment>
      ));
  };

  const renderGroup = (group: QueryNode) => (
    <span className={`nx-fd-chipgroup${isNot(group) ? " is-not" : ""}`} key={group.id}>
      {isNot(group) && <span className="nx-fd-chipnot">Not</span>}
      <span className="nx-fd-paren" aria-hidden="true">(</span>
      {renderList(group)}
      <span className="nx-fd-paren" aria-hidden="true">)</span>
    </span>
  );

  return (
    <div className="nx-fd-chips" aria-label="The question on screen" data-testid="condition-chips">
      <span className="nx-fd-eyebrow">{lead}</span>
      {hasTree && tree && (isNot(tree) ? renderGroup(tree) : renderList(tree))}
      {hasTree && extra && <span className="nx-fd-chipconj">AND</span>}
      {extra}
    </div>
  );
}
