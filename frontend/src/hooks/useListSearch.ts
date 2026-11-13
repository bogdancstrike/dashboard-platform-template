import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { applyParamChanges, type ParamChanges } from "@/hooks/useUrlState";

/**
 * A list page's address-backed filters with a debounced free-text box.
 *
 * The box answers every keystroke; the address (and so the query) follows a
 * moment later, replacing rather than pushing, because a search being typed is
 * an adjustment and not a place to come back to.
 */
export function useListSearch({ param = "q", delay = 250 }: { param?: string; delay?: number } = {}) {
  const [params, setParams] = useSearchParams();
  const [box, setBox] = useState(params.get(param) ?? "");
  const term = useDebouncedValue(box, delay);

  const set = (changes: ParamChanges) =>
    setParams((current) => applyParamChanges(current, changes), { replace: true });

  useEffect(() => {
    set({ [param]: term || null });
    // Only the settled term writes the address; `set` is a fresh closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  return { params, set, box, setBox, term };
}
