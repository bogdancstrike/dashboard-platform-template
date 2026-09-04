/**
 * The cross-layer contract of §4.
 *
 * Two failure modes are worth a test each, because both are silent:
 *
 * 1. The builder offers an operator the backend rejects — the user builds a
 *    rule and gets a 400 they cannot act on.
 * 2. The builder offers an operator its own widget type does not define — the
 *    operator dropdown renders empty and the rule can never be completed. This
 *    is what shipped before: `equal` on a select, `is_empty` on a number.
 *
 * The vocabularies on both sides are copied here rather than imported, because
 * that is the point: if either moves without the other, this fails.
 */

import { CoreConfig } from "@react-awesome-query-builder/core";
import { describe, expect, it } from "vitest";

import type { ExplorerField, FieldKind } from "@/api/explorer";

import { BUILDER_TYPE, builderOperator, builderOperators, queryBuilderConfig } from "./queryBuilderConfig";

/** `OPERATORS_BY_KIND` in backend/src/core/query.py. */
const BACKEND_OPERATORS: Record<FieldKind, string[]> = {
  text: ["eq", "ne", "contains", "not", "starts", "ends", "in", "not_in", "empty", "not_empty", "exists", "not_exists"],
  json: ["eq", "ne", "contains", "not", "starts", "ends", "in", "not_in", "empty", "not_empty", "exists", "not_exists"],
  array: ["eq", "ne", "contains", "not", "starts", "ends", "in", "not_in", "empty", "not_empty", "exists", "not_exists"],
  enum: ["eq", "ne", "in", "not_in", "empty", "not_empty", "exists", "not_exists"],
  uuid: ["eq", "ne", "in", "not_in", "empty", "not_empty", "exists", "not_exists"],
  bool: ["eq", "ne", "empty", "not_empty"],
  number: ["eq", "ne", "gt", "gte", "lt", "lte", "between", "in", "not_in", "empty", "not_empty", "exists", "not_exists"],
  datetime: ["eq", "ne", "before", "after", "gt", "gte", "lt", "lte", "between", "empty", "not_empty", "exists", "not_exists"],
};

/** `OPERATOR_ALIASES` in backend/src/core/query.py, plus the canonical names. */
const BACKEND_ACCEPTS = new Set([
  "eq", "ne", "contains", "not", "starts", "ends", "gt", "gte", "lt", "lte",
  "between", "before", "after", "in", "not_in", "empty", "not_empty", "exists", "not_exists",
  "equal", "equals", "==", "=", "select_equals",
  "not_equal", "!=", "<>", "select_not_equals",
  "like", "not_like", "does_not_contain", "starts_with", "ends_with",
  "greater", ">", "greater_or_equal", ">=", "less", "<", "less_or_equal", "<=",
  "range", "between_dates", "date_before", "date_after",
  "select_any_in", "multiselect_equals", "any_in",
  "select_not_any_in", "multiselect_not_equals", "not_any_in",
  "is_empty", "is_null", "is_not_empty", "is_not_null", "is_true", "is_false",
]);

const KINDS = Object.keys(BACKEND_OPERATORS) as FieldKind[];

/** The operators the query-builder library defines for a widget type. */
function libraryOperators(type: string): Set<string> {
  const definition = CoreConfig.types[type as keyof typeof CoreConfig.types];
  const operators = new Set<string>();
  for (const widget of Object.values(definition?.widgets ?? {})) {
    for (const operator of widget.operators ?? []) operators.add(operator);
  }
  // Text and number are lent the multiselect widget so "is one of" stays
  // reachable for them; see withMembershipWidget in queryBuilderConfig.
  if (type === "text" || type === "number") {
    operators.add("select_any_in").add("select_not_any_in");
  }
  return operators;
}

function field(kind: FieldKind): ExplorerField {
  return {
    name: `a_${kind}`,
    label: kind,
    kind,
    sortable: true,
    filterable: true,
    searchable: false,
    facet: false,
    operators: BACKEND_OPERATORS[kind],
    choices: kind === "enum" ? ["OPEN", "IN_PROGRESS"] : [],
  };
}

describe("the query builder's operator vocabulary", () => {
  it.each(KINDS)("translates every operator the backend allows for %s", (kind) => {
    const untranslated = BACKEND_OPERATORS[kind].filter((operator) => !builderOperator(kind, operator));
    expect(untranslated).toEqual([]);
  });

  it.each(KINDS)("only offers operators the %s widget can render", (kind) => {
    const supported = libraryOperators(BUILDER_TYPE[kind]);
    const unsupported = builderOperators(field(kind)).filter((operator) => !supported.has(operator));
    expect(unsupported).toEqual([]);
  });

  it.each(KINDS)("only emits operators the backend accepts for %s", (kind) => {
    const unknown = builderOperators(field(kind)).filter((operator) => !BACKEND_ACCEPTS.has(operator));
    expect(unknown).toEqual([]);
  });

  it("leaves no operator in the backend vocabulary unreachable from the UI", () => {
    const reachable = new Set(KINDS.flatMap((kind) => BACKEND_OPERATORS[kind]));
    const everyOperator = new Set(Object.values(BACKEND_OPERATORS).flat());
    // Every operator the backend defines appears on some kind, and every one of
    // those translates — so each is reachable from at least one field.
    for (const operator of everyOperator) {
      expect(reachable.has(operator)).toBe(true);
      const kind = KINDS.find((candidate) => BACKEND_OPERATORS[candidate].includes(operator));
      expect(builderOperator(kind as FieldKind, operator)).toBeTruthy();
    }
  });
});

describe("the query builder's configuration", () => {
  const config = queryBuilderConfig(KINDS.map(field));

  /** The library's `FieldOrGroup` union hides the leaf keys this asserts on. */
  const declared = (name: string) =>
    config.fields[name] as { fieldSettings?: unknown; valueSources?: string[] };

  it("declares one builder field per filterable catalogue field", () => {
    expect(Object.keys(config.fields)).toEqual(KINDS.map((kind) => `a_${kind}`));
  });

  it("omits fields the backend will not filter on", () => {
    const readOnly = { ...field("text"), name: "computed", filterable: false };
    expect(Object.keys(queryBuilderConfig([readOnly]).fields)).toEqual([]);
  });

  it("offers an enum's declared choices, spelled for a reader", () => {
    expect(declared("a_enum").fieldSettings).toMatchObject({
      listValues: [
        { value: "OPEN", title: "Open" },
        { value: "IN_PROGRESS", title: "In progress" },
      ],
    });
  });

  it("compares against values only, because the API cannot compare two columns", () => {
    expect(config.settings.valueSourcesInfo).toEqual({ value: { label: "Value" } });
    for (const kind of KINDS) {
      expect(declared(`a_${kind}`).valueSources).toEqual(["value"]);
    }
  });

  it("keeps a half-built rule on screen, since the backend skips it anyway", () => {
    expect(config.settings.removeEmptyRulesOnLoad).toBe(false);
    expect(config.settings.removeIncompleteRulesOnLoad).toBe(false);
  });

  it("stops nesting where core/rules.py stops accepting it", () => {
    expect(config.settings.maxNesting).toBe(12);
    expect(config.settings.maxNumberOfRules).toBe(200);
  });

  it("labels operators with the words the query inspector reads back", () => {
    expect(config.operators["like"]?.label).toBe("contains");
    expect(config.operators["select_any_in"]?.label).toBe("in");
    expect(config.operators["is_null"]?.label).toBe("is empty");
  });
});
