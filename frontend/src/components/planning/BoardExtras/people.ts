import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";
import type { Person } from "@/api/directory";

import { STALE, queryKeys } from "@/lib/queryKeys";

/** Everybody's name by id, for assignee swimlanes (the directory pages by fifty). */
export function usePeopleNames(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.planningPeople(),
    enabled,
    staleTime: STALE.long,
    queryFn: async ({ signal }) => {
      const names = new Map<string, Person>();
      for (let page = 1; page <= 6; page += 1) {
        const batch = await api.get<{ items: Person[]; pages: number }>("/api/directory/people", {
          params: { q: "", page, page_size: 50 },
          signal,
        });
        batch.items.forEach((person) => names.set(person.id, person));
        if (page >= batch.pages) break;
      }
      return names;
    },
  });
}
