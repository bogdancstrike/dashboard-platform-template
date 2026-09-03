import { useEffect, useMemo, useState } from "react";
import {
  AntdConfig,
  Builder,
  Query,
  Utils as QbUtils,
  type Config,
  type ImmutableTree,
  type JsonTree,
} from "@react-awesome-query-builder/antd";
import "@react-awesome-query-builder/antd/css/styles.css";

import type { ExplorerField } from "@/api/explorer";

const OPERATOR_ALIAS: Record<string, string> = {
  eq: "equal",
  ne: "not_equal",
  contains: "like",
  not: "not_like",
  starts: "starts_with",
  ends: "ends_with",
  gt: "greater",
  gte: "greater_or_equal",
  lt: "less",
  lte: "less_or_equal",
  before: "less",
  after: "greater",
  in: "select_any_in",
  not_in: "select_not_any_in",
  empty: "is_empty",
  not_empty: "is_not_empty",
  exists: "is_not_null",
  not_exists: "is_null",
};

const TYPE: Record<ExplorerField["kind"], string> = {
  text: "text",
  enum: "select",
  bool: "boolean",
  number: "number",
  datetime: "datetime",
  uuid: "text",
  json: "text",
  array: "text",
};

function emptyTree(): JsonTree {
  return {
    id: crypto.randomUUID(),
    type: "group",
    children1: [],
    properties: { conjunction: "AND", not: false },
  };
}

function queryConfig(fields: ExplorerField[]): Config {
  return {
    ...AntdConfig,
    settings: {
      ...AntdConfig.settings,
      showNot: true,
      canReorder: true,
      canRegroup: true,
      maxNesting: 12,
      maxNumberOfRules: 200,
      renderSize: "small",
    },
    fields: Object.fromEntries(
      fields.filter((field) => field.filterable).map((field) => {
        const operators = Array.from(
          new Set(field.operators.map((operator) => OPERATOR_ALIAS[operator] ?? operator)),
        );
        return [
          field.name,
          {
            label: field.label,
            type: TYPE[field.kind],
            operators,
            ...(field.kind === "enum"
              ? {
                  fieldSettings: {
                    listValues: field.choices.map((value) => ({ value, title: value })),
                    allowCustomValues: field.choices.length === 0,
                    showSearch: true,
                  },
                }
              : {}),
          },
        ];
      }),
    ),
  } as Config;
}

export function AdvancedQueryBuilder({
  fields,
  value,
  onChange,
}: {
  fields: ExplorerField[];
  value: Record<string, unknown> | null;
  onChange: (tree: Record<string, unknown>) => void;
}) {
  const config = useMemo(() => queryConfig(fields), [fields]);
  const blank = useMemo(emptyTree, []);
  const serialised = useMemo(() => JSON.stringify(value ?? blank), [value, blank]);
  const [tree, setTree] = useState<ImmutableTree>(() => QbUtils.loadTree(JSON.parse(serialised)));

  useEffect(() => {
    setTree(QbUtils.loadTree(JSON.parse(serialised)));
  }, [serialised]);

  const change = (next: ImmutableTree) => {
    setTree(next);
    onChange(QbUtils.getTree(next) as unknown as Record<string, unknown>);
  };

  return (
    <div className="nu-query-builder" aria-label="Advanced query builder">
      <Query
        {...config}
        value={tree}
        onChange={change}
        renderBuilder={(props) => <Builder {...props} />}
      />
    </div>
  );
}

/** Exported for the catalogue contract test: every backend operator maps once. */
export function queryBuilderOperator(operator: string): string {
  return OPERATOR_ALIAS[operator] ?? operator;
}
