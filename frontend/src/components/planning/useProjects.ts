import { useQuery } from "@tanstack/react-query";

import { explorerApi } from "@/api/explorer";
import { asText } from "@/lib/text";

export interface ProjectOption {
  id: string;
  code: string;
  name: string;
  color: string | null;
  status: string;
}

/** The projects a planning page can be narrowed to, active ones first. */
export function useProjects() {
  return useQuery({
    queryKey: ["planning-projects"],
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const page = await explorerApi.query(
        {
          resource_type: "project",
          columns: ["code", "name", "status"],
          page: 1,
          page_size: 200,
          sort: "name",
          order: "asc",
        },
        signal,
      );
      const items: ProjectOption[] = page.items.map((item) => ({
        id: item.id,
        code: asText(item.code),
        name: asText(item.name),
        color: null,
        status: asText(item.status),
      }));
      const rank = (status: string) => (status === "ACTIVE" ? 0 : status === "PLANNING" ? 1 : 2);
      return items.sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
    },
  });
}

export function projectOptions(projects: ProjectOption[] | undefined) {
  return (projects ?? []).map((project) => ({
    value: project.id,
    label: `${project.code} · ${project.name}`,
  }));
}
