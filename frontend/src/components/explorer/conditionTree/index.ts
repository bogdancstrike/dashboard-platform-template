/**
 * Edits on a condition tree, by node id, as plain JSON.
 *
 * The tree is the react-awesome-query-builder export the backend compiles
 * (`core/rules.py`): groups carry `properties.conjunction` / `properties.not`
 * and an id-keyed `children1`; rules carry `properties.field`, `operator` and a
 * `value` list. Every function here returns a new tree and never mutates its
 * argument, so the editor can hand each result straight to React state.
 */

export * from "./read";
export * from "./edit";
export * from "./words";
export { conditionReducer, type ConditionAction } from "./reducer";
