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

import { useMemo, type ReactNode } from "react";
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
  incompleteReason,
  isGroup,
  mapNode,
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
  const filterable = useMemo(() => fields.filter((field) => field.filterable), [fields]);
  const byName = useMemo(() => new Map(fields.map((field) => [field.name, field] as const)), [fields]);

  const ctx: Ctx = { tree, fields: filterable, byName, change: onChange };

  return (
    <div className="nx-fd-cb" aria-label="Advanced query builder">
      <GroupBox node={tree} depth={0} ctx={ctx} extraAdd={extraAdd} />
    </div>
  );
}

interface Ctx {
  tree: QueryNode;
  fields: ExplorerField[];
  byName: Map<string, ExplorerField>;
  change: (tree: QueryNode) => void;
}

/**
 * One group: a list of lines, each reading "Where …", "and …", "or …".
 *
 * The connective is the small word at the start of every line after the
 * first, and pressing it flips the whole group between and / or — the one
 * decision a group carries. NOT, duplicate and remove live behind the
 * group's "⋯"; a nested group is just an indented block.
 */
function GroupBox({ node, depth, parent, index = 0, ctx, extraAdd }: {
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
  const flip = () => ctx.change(setGroupProps(ctx.tree, id, { conjunction: conj === "AND" ? "OR" : "AND" }));
  const addRule = () => ctx.change(appendChild(ctx.tree, id, newRule()));
  const addGroup = () => {
    const group = newGroup(conj === "AND" ? "OR" : "AND");
    ctx.change(appendChild(ctx.tree, id, appendChild(group, group.id as string, newRule())));
  };

  const menu = [
    {
      key: "not",
      label: not ? "Match these again (remove NOT)" : "Exclude matches (NOT)",
      onClick: () => ctx.change(setGroupProps(ctx.tree, id, { not: !not })),
    },
    { key: "conj", label: `Match ${conj === "AND" ? "any" : "all"} of these instead`, onClick: flip },
    ...(root
      ? [{ key: "clear", label: "Remove every filter", danger: true, disabled: items.length === 0, onClick: () => ctx.change({ ...node, children1: {} }) }]
      : [
          ...moveItems(ctx, parent, id, index),
          { key: "dup", label: "Duplicate this group", onClick: () => ctx.change(duplicateById(ctx.tree, id)) },
          { key: "del", label: "Remove this group", danger: true, onClick: () => ctx.change(removeNode(ctx.tree, id)) },
        ]),
  ];

  return (
    <section
      className={`nx-fd-cb-group${root ? " is-root" : ""}${not ? " is-not" : ""}`}
      aria-label={root ? "Root group" : "Group"}
      data-depth={depth}
    >
      {items.map((child, position) => (
        <div className="nx-fd-cb-line" key={child.id}>
          <span className="nx-fd-cb-lead">
            {position === 0 ? (
              <span className="nx-fd-cb-where">{not ? "Where not" : "Where"}</span>
            ) : (
              <Tooltip title={`Match ${conj === "AND" ? "any" : "all"} of these instead`}>
                <button
                  type="button"
                  className={`nx-fd-cb-conj${conj === "OR" ? " is-or" : ""}`}
                  data-testid="conj-toggle"
                  aria-label={`${conj === "AND" ? "and" : "or"} — switch to ${conj === "AND" ? "or" : "and"}`}
                  onClick={flip}
                >
                  {conj === "AND" ? "and" : "or"}
                </button>
              </Tooltip>
            )}
          </span>
          {isGroup(child) ? (
            <GroupBox node={child} depth={depth + 1} parent={node} index={position} ctx={ctx} />
          ) : (
            <RuleRow node={child} parent={node} index={position} ctx={ctx} />
          )}
        </div>
      ))}

      <div className="nx-fd-cb-add">
        <button type="button" className="nx-fd-cb-addrule" onClick={addRule}>
          + Add filter
        </button>
        {depth < 2 && (
          <button type="button" className="nx-fd-cb-addgroup" onClick={addGroup}>
            + Add group
          </button>
        )}
        {root && extraAdd}
        <Dropdown menu={{ items: menu }} trigger={["click"]} placement="bottomRight">
          <button type="button" className="nx-fd-cb-icon nx-fd-cb-more" aria-label={root ? "Root group options" : "Group options"}>
            <FdIcon name="dots" size={15} strokeWidth={3} />
          </button>
        </Dropdown>
      </div>
    </section>
  );
}

/** "Move up" / "Move down" menu items for a child of `parent`. */
function moveItems(ctx: Ctx, parent: QueryNode | undefined, id: string, index: number) {
  if (!parent) return [];
  const count = children(parent).length;
  const parentId = parent.id as string;
  return [
    { key: "up", label: "Move up", disabled: index === 0, onClick: () => ctx.change(moveWithin(ctx.tree, parentId, id, index - 1)) },
    { key: "down", label: "Move down", disabled: index >= count - 1, onClick: () => ctx.change(moveWithin(ctx.tree, parentId, id, index + 1)) },
  ];
}

/** One filter on one line: [field] [operator] [value] [⋯] [×]. */
function RuleRow({ node, parent, index, ctx }: {
  node: QueryNode;
  parent: QueryNode;
  index: number;
  ctx: Ctx;
}) {
  const id = node.id as string;
  const { field: fieldName, operator, value } = ruleParts(node);
  const field = ctx.byName.get(fieldName);
  const missing = incompleteReason(node);
  const operators = field ? builderOperators(field) : [];

  return (
    <div
      role="group"
      aria-label={`Rule: ${field?.label ?? "unfinished"} ${operator ? operatorWords(operator, field?.kind) : ""}${missing ? " (incomplete)" : ""}`.trim()}
      className={`nx-fd-cb-rule${missing ? " is-incomplete" : ""}`}
    >
      <div className="nx-fd-cb-f rule--field">
        <Select
          variant="borderless"
          className="nx-fd-cb-ctl nx-fd-cb-fieldsel"
          popupMatchSelectWidth={false}
          showSearch
          optionFilterProp="title"
          aria-label={field ? `Field: ${field.label}, ${fieldKindLabel(field)}` : "Field: not chosen"}
          placeholder="Field"
          value={fieldName || undefined}
          onChange={(next: string) => {
            const chosen = ctx.byName.get(next);
            if (chosen) ctx.change(setRuleField(ctx.tree, id, chosen));
          }}
          labelRender={() => (
            <span className="nx-fd-cb-fieldlabel">
              <FdIcon name={fieldIcon(field)} size={13} strokeWidth={2.1} className="nx-fd-cb-ficon" />
              <span className="nx-fd-cb-ellipsis">{field?.label ?? fieldName}</span>
            </span>
          )}
          options={ctx.fields.map((item) => ({
            value: item.name,
            title: item.label,
            label: (
              <span className="nx-fd-cb-fieldopt">
                <FdIcon name={fieldIcon(item)} size={13} strokeWidth={2.1} className="nx-fd-cb-ficon" />
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
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          menu={{
            items: [
              { key: "dup", label: "Duplicate this rule", onClick: () => ctx.change(duplicateById(ctx.tree, id)) },
              ...moveItems(ctx, parent, id, index),
              {
                key: "wrap",
                label: "Turn into a group",
                onClick: () => {
                  const group = newGroup("OR");
                  ctx.change(mapNode(ctx.tree, id, (rule) => appendChild(group, group.id as string, rule)));
                },
              },
            ],
          }}
        >
          <button type="button" className="nx-fd-cb-icon nx-fd-cb-hover" aria-label={`More for this rule: ${field?.label ?? "unfinished"}`}>
            <FdIcon name="dots" size={14} strokeWidth={3} />
          </button>
        </Dropdown>
        <button
          type="button"
          className="nx-fd-cb-icon"
          aria-label="Remove this rule"
          onClick={() => ctx.change(removeNode(ctx.tree, id))}
        >
          <FdIcon name="close" size={13} strokeWidth={2.2} />
        </button>
      </div>
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
    return <span className="nx-fd-cb-ctl nx-fd-cb-novalue">Value</span>;
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
