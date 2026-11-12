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

import { useMemo, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { DatePicker, Dropdown, Input, InputNumber, Select, Tooltip } from "antd";
import dayjs, { type Dayjs } from "dayjs";

import type { ExplorerField } from "@/api/explorer";
import { asText } from "@/lib/text";

import {
  MULTI_VALUE,
  NO_VALUE,
  appendChild,
  children,
  conjunctionOf,
  duplicateById,
  groupLabels,
  incompleteReason,
  isGroup,
  isNot,
  moveWithin,
  newGroup,
  newRule,
  normalise,
  operatorWords,
  removeNode,
  ruleParts,
  setGroupProps,
  setRuleField,
  setRuleOperator,
  setRuleValue,
  type Conjunction,
} from "./conditionTree";
import { FdIcon, type FdIconName } from "./fdIcons";
import { BUILDER_TYPE, builderOperators } from "./queryBuilderConfig";
import type { QueryNode } from "./queryTree";

const DATE_FORMAT = "YYYY-MM-DD HH:mm:ss";

export interface ConditionBuilderProps {
  fields: ExplorerField[];
  value: QueryNode | null;
  onChange: (tree: QueryNode) => void;
  /** Extra controls at the end of the root's add row ("Add from a saved search"). */
  extraAdd?: ReactNode;
}

export function fieldIcon(field?: ExplorerField): FdIconName {
  if (!field) return "text";
  if (field.references) return "rel";
  switch (field.kind) {
    case "enum":
      return "enum";
    case "datetime":
      return "date";
    case "number":
      return "number";
    case "bool":
      return "bool";
    case "array":
      return "tag";
    default:
      return "text";
  }
}

export function fieldKindLabel(field?: ExplorerField): string {
  if (!field) return "Field";
  if (field.references) return "Relation";
  return { enum: "Choice", datetime: "Date", number: "Number", bool: "Yes / no", array: "Tags", text: "Text", uuid: "Id", json: "Data" }[field.kind] ?? "Text";
}

/** `IN_PROGRESS` is a database value; `In progress` is what a person reads. */
export function humanise(value: string): string {
  const spaced = String(value).replaceAll("_", " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function ConditionBuilder({ fields, value, onChange, extraAdd }: ConditionBuilderProps) {
  const tree = useMemo(() => normalise(value), [value]);
  const labels = useMemo(() => groupLabels(tree), [tree]);
  const filterable = useMemo(() => fields.filter((field) => field.filterable), [fields]);
  const byName = useMemo(() => new Map(fields.map((field) => [field.name, field] as const)), [fields]);
  const [dragging, setDragging] = useState<{ id: string; parent: string } | null>(null);

  const ctx: Ctx = {
    tree,
    labels,
    fields: filterable,
    byName,
    dragging,
    setDragging,
    change: onChange,
  };

  return (
    <div className="nx-fd-cb" aria-label="Advanced query builder">
      <GroupBox node={tree} depth={0} ctx={ctx} extraAdd={extraAdd} />
    </div>
  );
}

interface Ctx {
  tree: QueryNode;
  labels: Map<string, string>;
  fields: ExplorerField[];
  byName: Map<string, ExplorerField>;
  dragging: { id: string; parent: string } | null;
  setDragging: (value: { id: string; parent: string } | null) => void;
  change: (tree: QueryNode) => void;
}

function groupSentence(node: QueryNode): ReactNode {
  const count = children(node).length;
  const conj = conjunctionOf(node);
  const not = isNot(node);
  if (count === 0) {
    return not ? "Excludes nothing yet — add a rule" : "Matches every record — add a rule to narrow it";
  }
  const q = count === 1 ? "this" : conj === "AND" ? "ALL" : "ANY";
  const pre = not ? (count === 1 ? "Exclude records where " : "Exclude records matching ") : "Match ";
  const post = count === 1 ? " condition is true" : ` of these ${count} conditions`;
  return (
    <>
      {pre}
      <b>{q}</b>
      {post}
    </>
  );
}

function GroupBox({ node, depth, parent, ctx, extraAdd }: {
  node: QueryNode;
  depth: number;
  parent?: string;
  ctx: Ctx;
  extraAdd?: ReactNode;
}) {
  const id = node.id as string;
  const root = depth === 0;
  const conj = conjunctionOf(node);
  const not = isNot(node);
  const label = root ? "Root" : `Group ${ctx.labels.get(id) ?? ""}`;
  const items = children(node);
  const set = (patch: { conjunction?: Conjunction; not?: boolean }) => ctx.change(setGroupProps(ctx.tree, id, patch));
  const addRule = () => ctx.change(appendChild(ctx.tree, id, newRule()));
  const addGroup = () => {
    const group = newGroup(conj === "AND" ? "OR" : "AND");
    const withRule = appendChild(group, group.id as string, newRule());
    ctx.change(appendChild(ctx.tree, id, withRule));
  };

  const menu = [
    { key: "rule", label: "Add a rule here", onClick: addRule },
    { key: "group", label: "Add a group here", onClick: addGroup },
    ...(root
      ? [{ key: "clear", label: "Remove every rule", danger: true, disabled: items.length === 0, onClick: () => ctx.change({ ...node, children1: {} }) }]
      : [
          { key: "dup", label: "Duplicate this group", onClick: () => ctx.change(duplicateById(ctx.tree, id)) },
          { key: "del", label: "Remove this group", danger: true, onClick: () => ctx.change(removeNode(ctx.tree, id)) },
        ]),
  ];

  const tone = not ? "not" : root ? "root" : depth % 2 === 1 ? "a" : "b";

  return (
    <section
      className={`nx-fd-cb-group nx-fd-cb-group--${tone}${root ? " is-root" : ""}`}
      aria-label={root ? "Root group" : label}
      data-depth={depth}
      {...dragTarget(ctx, parent, id)}
    >
      <div className="nx-fd-cb-ghead">
        <span className="nx-fd-cb-gtag">{not ? `Not · ${label}` : label}</span>
        <div className="nx-fd-cb-seg" role="group" aria-label={`${root ? "Root group" : label} conjunction`}>
          {(["AND", "OR"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={conj === option}
              className={conj === option ? "is-on" : ""}
              onClick={() => set({ conjunction: option })}
            >
              {option === "AND" ? "And" : "Or"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`nx-fd-cb-not${not ? " is-on" : ""}`}
          aria-pressed={not}
          onClick={() => set({ not: !not })}
        >
          <span className="nx-fd-cb-notbox" aria-hidden="true" />
          Not
        </button>
        <span className="nx-fd-cb-sentence">{groupSentence(node)}</span>
        <Dropdown menu={{ items: menu }} trigger={["click"]} placement="bottomRight">
          <button type="button" className="nx-fd-cb-icon nx-fd-cb-more" aria-label={`${root ? "Root group" : label} options`}>
            <FdIcon name="dots" size={16} strokeWidth={3} />
          </button>
        </Dropdown>
      </div>

      <div className="nx-fd-cb-items">
        {items.map((child, index) => (
          <div className="nx-fd-cb-item" key={child.id}>
            {index > 0 && (
              <div className="nx-fd-cb-conj" aria-hidden="true">
                <span className={conj === "OR" ? "is-or" : ""}>{conj}</span>
              </div>
            )}
            {isGroup(child) ? (
              <GroupBox node={child} depth={depth + 1} parent={id} ctx={ctx} />
            ) : (
              <RuleRow node={child} parent={id} index={index} siblings={items.length} ctx={ctx} />
            )}
          </div>
        ))}
      </div>

      <div className={`nx-fd-cb-add${root ? " is-root" : ""}`}>
        <button type="button" className="nx-fd-cb-addrule" onClick={addRule}>
          <span aria-hidden="true">+</span> Add rule
        </button>
        <button type="button" className="nx-fd-cb-addgroup" onClick={addGroup}>
          <span aria-hidden="true">+</span> Add group
        </button>
        {root && extraAdd}
      </div>
    </section>
  );
}

/** Drop handling for reordering siblings inside one group. */
function dragTarget(ctx: Ctx, parent: string | undefined, id: string) {
  if (!parent) return {};
  return {
    onDragOver: (event: DragEvent) => {
      if (ctx.dragging && ctx.dragging.parent === parent && ctx.dragging.id !== id) event.preventDefault();
    },
    onDrop: (event: DragEvent) => {
      if (!ctx.dragging || ctx.dragging.parent !== parent) return;
      event.preventDefault();
      event.stopPropagation();
      const parentNode = findNode(ctx.tree, parent);
      const target = parentNode ? children(parentNode).findIndex((child) => child.id === id) : -1;
      if (target >= 0) ctx.change(moveWithin(ctx.tree, parent, ctx.dragging.id, target));
      ctx.setDragging(null);
    },
  };
}

function findNode(tree: QueryNode, id: string): QueryNode | null {
  if (tree.id === id) return tree;
  for (const child of children(tree)) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function RuleRow({ node, parent, index, siblings, ctx }: {
  node: QueryNode;
  parent: string;
  index: number;
  siblings: number;
  ctx: Ctx;
}) {
  const id = node.id as string;
  const { field: fieldName, operator, value } = ruleParts(node);
  const field = ctx.byName.get(fieldName);
  const missing = incompleteReason(node);
  const [armed, setArmed] = useState(false);
  const name = field?.label ?? "rule";

  const onHandleKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      ctx.change(moveWithin(ctx.tree, parent, id, index - 1));
    } else if (event.key === "ArrowDown" && index < siblings - 1) {
      event.preventDefault();
      ctx.change(moveWithin(ctx.tree, parent, id, index + 1));
    }
  };

  const operators = field ? builderOperators(field) : [];

  return (
    <div className="nx-fd-cb-rulewrap">
      <div
        role="group"
        aria-label={`Rule: ${field?.label ?? "unfinished"} ${operator ? operatorWords(operator, field?.kind) : ""}${missing ? " (incomplete)" : ""}`.trim()}
        className={`nx-fd-cb-rule${missing ? " is-incomplete" : ""}${ctx.dragging?.id === id ? " is-dragging" : ""}`}
        draggable={armed}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", id);
          ctx.setDragging({ id, parent });
        }}
        onDragEnd={() => {
          setArmed(false);
          ctx.setDragging(null);
        }}
        {...dragTarget(ctx, parent, id)}
      >
        <Tooltip title="Drag, or use the arrow keys, to reorder">
          <button
            type="button"
            className="nx-fd-cb-handle"
            aria-label={`Reorder rule: ${name}`}
            onPointerDown={() => setArmed(true)}
            onPointerUp={() => setArmed(false)}
            onKeyDown={onHandleKey}
          >
            <FdIcon name="drag" size={14} strokeWidth={3.2} />
          </button>
        </Tooltip>

        <div className="nx-fd-cb-f rule--field">
          <Select
            variant="borderless"
            className="nx-fd-cb-ctl nx-fd-cb-fieldsel"
            popupMatchSelectWidth={false}
            showSearch
            optionFilterProp="title"
            aria-label={field ? `Field: ${field.label}, ${fieldKindLabel(field)}` : "Field: not chosen"}
            placeholder={<span className="nx-fd-cb-ph"><span className="nx-fd-cb-ticon"><FdIcon name="text" size={14} /></span>Choose a field</span>}
            value={fieldName || undefined}
            onChange={(next: string) => {
              const chosen = ctx.byName.get(next);
              if (chosen) ctx.change(setRuleField(ctx.tree, id, chosen));
            }}
            labelRender={() => (
              <span className="nx-fd-cb-fieldlabel">
                <span className="nx-fd-cb-ticon" title={`${fieldKindLabel(field)} field`}>
                  <FdIcon name={fieldIcon(field)} size={14} strokeWidth={2.1} />
                </span>
                <span className="nx-fd-cb-ellipsis">{field?.label ?? fieldName}</span>
              </span>
            )}
            options={ctx.fields.map((item) => ({
              value: item.name,
              title: item.label,
              label: (
                <span className="nx-fd-cb-fieldopt">
                  <span className="nx-fd-cb-ticon"><FdIcon name={fieldIcon(item)} size={13} strokeWidth={2.1} /></span>
                  <span className="nx-fd-cb-ellipsis">{item.label}</span>
                  <span className="nx-fd-cb-kind">{fieldKindLabel(item)}</span>
                </span>
              ),
            }))}
          />
        </div>

        <div className="nx-fd-cb-o rule--operator">
          <Select
            variant="borderless"
            className="nx-fd-cb-ctl"
            popupMatchSelectWidth={false}
            aria-label={operator ? `Operator: ${operatorWords(operator, field?.kind)}` : "Operator"}
            disabled={!field}
            placeholder="is"
            value={operator || undefined}
            onChange={(next: string) => ctx.change(setRuleOperator(ctx.tree, id, next))}
            options={operators.map((op) => ({ value: op, label: operatorWords(op, field?.kind) }))}
          />
        </div>

        <div className="nx-fd-cb-v rule--value">
          <ValueEditor
            field={field}
            operator={operator}
            value={value}
            onChange={(next) => ctx.change(setRuleValue(ctx.tree, id, next))}
          />
        </div>

        <div className="nx-fd-cb-a">
          <Tooltip title="Duplicate">
            <button
              type="button"
              className="nx-fd-cb-icon"
              aria-label="Duplicate this rule"
              onClick={() => ctx.change(duplicateById(ctx.tree, id))}
            >
              <FdIcon name="copy" />
            </button>
          </Tooltip>
          <Tooltip title="Remove">
            <button
              type="button"
              className="nx-fd-cb-icon"
              aria-label="Remove this rule"
              onClick={() => ctx.change(removeNode(ctx.tree, id))}
            >
              <FdIcon name="trash" />
            </button>
          </Tooltip>
        </div>
      </div>
      {missing && (
        <span className="nx-fd-cb-warn" role="note">
          <FdIcon name="warn" size={13} strokeWidth={2.2} />
          {missing === "field"
            ? "Choose a field — this rule is skipped until it is complete."
            : "Choose a value — this rule is skipped until it is complete."}
        </span>
      )}
    </div>
  );
}

function ValueEditor({ field, operator, value, onChange }: {
  field?: ExplorerField;
  operator: string;
  value: unknown[];
  onChange: (value: unknown[]) => void;
}) {
  if (!field) {
    return <span className="nx-fd-cb-ctl nx-fd-cb-novalue">Pick a field first</span>;
  }
  if (NO_VALUE.has(operator)) {
    return <span className="nx-fd-cb-novalue">no value needed</span>;
  }
  const type = BUILDER_TYPE[field.kind];
  const label = `Value for ${field.label}`;

  if (MULTI_VALUE.has(operator)) {
    const list = (Array.isArray(value[0]) ? value[0] : []) as Array<string | number>;
    const choices = type === "select" ? field.choices : [];
    return (
      <Select
        mode={choices.length ? "multiple" : "tags"}
        variant="borderless"
        className="nx-fd-cb-ctl nx-fd-cb-multi"
        aria-label={label}
        placeholder={choices.length ? "Choose values" : "Type a value, Enter to add"}
        value={list.map(String)}
        onChange={(next: string[]) =>
          onChange([type === "number" ? next.map(Number).filter((n) => !Number.isNaN(n)) : next])
        }
        options={choices.map((choice) => ({ value: choice, label: humanise(choice) }))}
        tokenSeparators={[","]}
      />
    );
  }

  if (operator === "between") {
    if (type === "datetime") {
      const [a, b] = value as [string | null, string | null];
      return (
        <DatePicker.RangePicker
          variant="borderless"
          className="nx-fd-cb-ctl"
          aria-label={label}
          value={[a ? dayjs(a) : null, b ? dayjs(b) : null]}
          onChange={(range) =>
            onChange([range?.[0]?.format(DATE_FORMAT) ?? null, range?.[1]?.format(DATE_FORMAT) ?? null])
          }
        />
      );
    }
    const [a, b] = value as [number | null, number | null];
    return (
      <span className="nx-fd-cb-between">
        <InputNumber variant="borderless" className="nx-fd-cb-ctl nx-fd-cb-num" aria-label={`${label}, from`} value={a} onChange={(next) => onChange([next, b ?? null])} />
        <span className="nx-fd-cb-and">and</span>
        <InputNumber variant="borderless" className="nx-fd-cb-ctl nx-fd-cb-num" aria-label={`${label}, to`} value={b} onChange={(next) => onChange([a ?? null, next])} />
      </span>
    );
  }

  const single = value[0];
  const empty = single === null || single === undefined || single === "";

  if (type === "select") {
    return (
      <Select
        variant="borderless"
        className={`nx-fd-cb-ctl nx-fd-cb-valsel${empty ? " is-empty" : ""}`}
        popupMatchSelectWidth={false}
        showSearch
        aria-label={empty ? `${label}: not chosen` : label}
        placeholder="Choose a value"
        value={empty ? undefined : asText(single)}
        onChange={(next: string) => onChange([next])}
        options={field.choices.map((choice) => ({ value: choice, label: humanise(choice) }))}
        {...(field.choices.length === 0 ? { mode: undefined } : {})}
      />
    );
  }
  if (type === "boolean") {
    return (
      <Select
        variant="borderless"
        className={`nx-fd-cb-ctl nx-fd-cb-valsel${empty ? " is-empty" : ""}`}
        aria-label={label}
        placeholder="Choose a value"
        value={empty ? undefined : asText(single)}
        onChange={(next: string) => onChange([next === "true"])}
        options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]}
      />
    );
  }
  if (type === "number") {
    return (
      <InputNumber
        variant="borderless"
        className="nx-fd-cb-ctl nx-fd-cb-num"
        aria-label={label}
        placeholder="Value"
        value={empty ? null : Number(single)}
        onChange={(next) => onChange([next])}
      />
    );
  }
  if (type === "datetime") {
    return (
      <DatePicker
        variant="borderless"
        className="nx-fd-cb-ctl nx-fd-cb-date"
        aria-label={label}
        value={empty ? null : dayjs(asText(single))}
        onChange={(next: Dayjs | null) => onChange([next ? next.format(DATE_FORMAT) : null])}
      />
    );
  }
  return (
    <label className="nx-fd-cb-ctl nx-fd-cb-text">
      <span aria-hidden="true">“</span>
      <Input
        variant="borderless"
        aria-label={label}
        placeholder="Type a value"
        value={empty ? "" : asText(single)}
        onChange={(event) => onChange([event.target.value])}
      />
      <span aria-hidden="true">”</span>
    </label>
  );
}
