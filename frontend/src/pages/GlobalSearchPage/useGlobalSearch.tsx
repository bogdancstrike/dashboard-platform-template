import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClearOutlined, DatabaseOutlined, FilterOutlined } from "@ant-design/icons";
import { usePageCommands } from "@/commands/CommandContext";
import { searchApi, type GlobalHit } from "@/api/search";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { queryKeys } from "@/lib/queryKeys";
import { MIN_TERM } from "./searchConsts";

/**
 * Global search's state: the term and dataset filter in the address, the grouped results, and the keyboard cursor that walks them.
 */
export function useGlobalSearch() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const term = params.get("q") ?? "";
  const debounced = useDebouncedValue(term.trim(), 280);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useQuery({
    queryKey: queryKeys.globalSearch(debounced),
    queryFn: ({ signal }) => searchApi.global(debounced, signal),
    enabled: debounced.length >= MIN_TERM,
    placeholderData: (previous) => previous,
  });

  // One flat list across the groups: the keyboard does not care where a
  // dataset ends, and neither does somebody looking for one record.
  const flattened = useMemo(
    () => (results.data?.groups ?? []).flatMap((group) => group.items),
    [results.data],
  );

  useEffect(() => setCursor(0), [debounced]);

  /**
   * What this page can do, for the palette (§31).
   *
   * The palette searches records itself, so the useful commands here are the
   * ones it cannot do: taking a term that matched too much into a page that
   * can narrow it, and clearing a term that matched nothing.
   */
  usePageCommands("global-search", [
    ...(term
      ? [
          {
            id: "search.explore",
            label: "Narrow this search in the explorer",
            icon: <FilterOutlined />,
            keywords: "filter refine conditions advanced narrow",
            run: () => navigate(`/explore?q=${encodeURIComponent(term)}`),
          },
          {
            id: "search.clear",
            label: "Clear the search",
            icon: <ClearOutlined />,
            keywords: "reset empty start over",
            run: () => setParams({}, { replace: true }),
          },
        ]
      : []),
    {
      id: "search.catalogue",
      label: "See what there is to search",
      icon: <DatabaseOutlined />,
      keywords: "catalog datasets fields schema declaration",
      run: () => navigate("/find/catalog"),
    },
  ]);

  /**
   * Where a hit lives: its own record page when the dataset has one (the
   * server publishes the path for exactly this), else the explorer narrowed to
   * that one record. Opening a customer used to land on a one-row explorer
   * table, a click away from the customer.
   */
  const open = (hit: GlobalHit) => {
    const path = results.data?.groups.find((group) => group.resource_type === hit.resource_type)?.path;
    navigate(path ? `${path}/${hit.id}` : `/explore?resource=${hit.resource_type}&f.id=${hit.id}`);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (flattened.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (cursor + step + flattened.length) % flattened.length;
      setCursor(next);
      const hits = listRef.current?.querySelectorAll("[data-hit]");
      hits?.[next]?.scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter") {
      const hit = flattened[cursor];
      if (hit) {
        event.preventDefault();
        open(hit);
      }
    }
  };

  const tooShort = term.trim().length > 0 && term.trim().length < MIN_TERM;
  const groups = results.data?.groups ?? [];
  const only = params.get("type") ?? "";
  const shown = only ? groups.filter((group) => group.resource_type === only) : groups;
  const setType = (next: string) => {
    const search = new URLSearchParams(params);
    if (next) search.set("type", next);
    else search.delete("type");
    setParams(search, { replace: true });
  };

  return { params, setParams, navigate, term, debounced, cursor, setCursor, listRef, results, flattened, open, onKeyDown, tooShort, groups, only, shown, setType };
}

export type GlobalSearchModel = ReturnType<typeof useGlobalSearch>;
