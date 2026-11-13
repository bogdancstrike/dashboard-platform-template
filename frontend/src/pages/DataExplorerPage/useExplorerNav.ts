import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import type { SavedSearch } from "@/api/explorer";
import { applyParamChanges } from "@/hooks/useUrlState";
import { asText } from "@/lib/text";

/** Writing the explorer's address: part of the question, a drawer in or out, a dataset, a saved search. */
export function useExplorerNav() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const location = useLocation();

  /**
   * Change part of the question, leaving the rest of the URL alone.
   *
   * Built from the *current* parameters rather than the ones this render
   * captured: two handlers firing in one tick — opening a saved search and
   * closing the panel it came from — would otherwise have the second write
   * back the state the first had just replaced, silently discarding it.
   */
  const set = (changes: Record<string, string | number | null>, replace = true, overlay = false) => {
    setParams((current) => applyParamChanges(current, changes), { replace, ...(overlay ? { state: { overlay: true } } : {}) });
  };

  /**
   * Drawers live in the address, pushed, so back walks out of them one at a
   * time — Saved → Rules → the page — on a browser and on a phone's gesture.
   * Closing with × is the same step back when this entry was pushed by an
   * open; arriving on a deep link, it just drops the parameter.
   */
  const openPanel = (changes: Record<string, string | null>) => set(changes, false, true);
  const pushed = Boolean((location.state as { overlay?: boolean } | null)?.overlay);
  const closePanel = (changes: Record<string, string | null>) => {
    if (pushed) navigate(-1);
    else set(changes);
  };
  const chooseResource = (key: string) => {
    const next = new URLSearchParams();
    next.set("resource", key);
    setParams(next);
  };

  const openSaved = (saved: SavedSearch) => {
    const next = new URLSearchParams();
    next.set("resource", saved.resource_type);
    if (saved.query_text) next.set("q", saved.query_text);
    if (saved.condition_tree) next.set("tree", JSON.stringify(saved.condition_tree));
    Object.entries(saved.filters).forEach(([name, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        next.set(`f.${name}`, Array.isArray(value) ? value.join(",") : asText(value));
      }
    });
    next.set("columns", saved.columns.join(","));
    next.set("sort", saved.sort);
    next.set("order", saved.order);
    next.set("page_size", String(saved.page_size));
    next.set("view", saved.view_mode);
    next.set("saved", saved.id);
    // Everything, including closing the panel, in one write: `panel` is simply
    // absent from the parameters a saved search restores.
    setParams(next);
  };

  return { params, setParams, navigate, set, openPanel, closePanel, chooseResource, openSaved };
}
