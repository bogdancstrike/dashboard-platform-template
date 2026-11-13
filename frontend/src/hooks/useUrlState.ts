import { useSearchParams } from "react-router-dom";

/** A change to the address: a value sets the key, an empty one removes it. */
export type ParamChanges = Record<string, string | number | null | undefined>;

/**
 * `current` with `changes` applied, as a new object.
 *
 * `null`, `undefined` and `""` remove the key, so a cleared filter leaves no
 * `?status=` behind; anything else is written as a string.
 */
export function applyParamChanges(current: URLSearchParams, changes: ParamChanges): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === "") next.delete(key);
    else next.set(key, String(value));
  }
  return next;
}

/**
 * Page state kept in the address (§history).
 *
 * `places` are where the reader *is* — a board, a thread, an open record — and
 * setting one pushes an entry so back returns to it; every other change is an
 * adjustment to the same place and replaces. `replace` overrides the rule for
 * one call.
 */
export function useUrlState(places: readonly string[] = []) {
  const [params, setParams] = useSearchParams();
  const set = (changes: ParamChanges, options: { replace?: boolean } = {}) =>
    setParams((current) => applyParamChanges(current, changes), {
      replace: options.replace ?? !Object.entries(changes).some(([key, value]) => places.includes(key) && value),
    });
  return { params, set };
}
