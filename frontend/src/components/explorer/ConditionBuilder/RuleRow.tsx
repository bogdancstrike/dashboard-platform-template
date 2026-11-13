import { Dropdown, Select } from "antd";

import { incompleteReason, newGroup, operatorWords, ruleParts } from "../conditionTree";
import { FdIcon } from "@/components/icons/FdIcon";
import { builderOperators } from "../queryBuilderConfig";
import type { QueryNode } from "../queryTree";

import { moveItems } from "./moveItems";
import { ValueEditor } from "./ValueEditor";
import type { Ctx } from "./context";
import { fieldIcon, fieldKindLabel } from "./fieldMeta";

/** One filter on one line: [field] [operator] [value] [⋯] [×]. */
export function RuleRow({ node, parent, index, ctx }: {
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
            if (chosen) ctx.dispatch({ type: "setField", id, field: chosen });
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
          onChange={(next: string) => ctx.dispatch({ type: "setOperator", id, operator: next })}
          options={operators.map((op) => ({ value: op, label: operatorWords(op, field?.kind) }))}
        />
      </div>

      <div className="nx-fd-cb-v rule--value">
        <ValueEditor
          field={field}
          operator={operator}
          value={value}
          onChange={(next) => ctx.dispatch({ type: "setValue", id, value: next })}
        />
      </div>

      <div className="nx-fd-cb-a">
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          menu={{
            items: [
              { key: "dup", label: "Duplicate this rule", onClick: () => ctx.dispatch({ type: "duplicate", id }) },
              ...moveItems(ctx, parent, id, index),
              {
                key: "wrap",
                label: "Turn into a group",
                onClick: () => {
                  const group = newGroup("OR");
                  ctx.dispatch({ type: "wrap", id, group });
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
          className="nx-fd-cb-icon is-danger"
          aria-label="Remove this rule"
          onClick={() => ctx.dispatch({ type: "remove", id })}
        >
          <FdIcon name="trash" size={15} />
        </button>
      </div>
    </div>
  );
}
