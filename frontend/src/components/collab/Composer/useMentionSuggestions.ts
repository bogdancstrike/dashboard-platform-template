import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { directoryApi } from "@/api/directory";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { mentionAt, rankPeople } from "./mentions";

/** The people an "@name" being typed could mean, best match first. */
export function useMentionSuggestions(active: ReturnType<typeof mentionAt>) {
  const term = useDebouncedValue(active?.query ?? "", 150);
  const people = useQuery({
    queryKey: queryKeys.directoryPeople(term, "mention"),
    // A wide net, ranked here: the directory sorts by name, so "@Mar" would
    // otherwise fill its first page with Amaras before reaching Mara.
    queryFn: ({ signal }) => directoryApi.people(term, signal, 50),
    enabled: active !== null,
    staleTime: STALE.minute,
  });
  const suggestions = useMemo(
    () => (active ? rankPeople(people.data?.items ?? [], active.query).slice(0, 6) : []),
    [active, people.data],
  );
  return suggestions;
}
