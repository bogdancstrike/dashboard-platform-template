import { Select, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { timeApi, type Subject, type SubjectType } from "@/api/time";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { STALE, queryKeys } from "@/lib/queryKeys";

/** "task:<uuid>" — one string so a Select can hold a subject of any kind. */
export function subjectKey(type: SubjectType, id: string): string {
  return `${type}:${id}`;
}

export function parseSubjectKey(value: string | undefined): { subject_type: SubjectType; subject_id: string } | null {
  if (!value) return null;
  const [type, id] = value.split(":");
  if (!type || !id) return null;
  return { subject_type: type as SubjectType, subject_id: id };
}

const KIND_LABEL: Record<SubjectType, string> = { task: "Task", ticket: "Ticket", project: "Project" };

/**
 * What time is booked against: my recent work first, then a search across
 * tasks, tickets and projects. The server decides what exists; this only asks.
 */
export function SubjectPicker({
  value,
  onChange,
  autoFocus,
  initial,
}: {
  value?: string;
  onChange?: (value: string, subject: Subject | undefined) => void;
  autoFocus?: boolean;
  /** A subject already chosen elsewhere, so its label shows before any search. */
  initial?: Subject;
}) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 250);
  const found = useQuery({
    queryKey: queryKeys.time("subjects", q),
    queryFn: ({ signal }) => timeApi.subjects(q, signal),
    staleTime: STALE.short,
  });
  const items = [...(initial ? [initial] : []), ...(found.data?.items ?? [])].filter(
    (item, index, all) => all.findIndex((other) => other.subject_id === item.subject_id) === index,
  );

  return (
    <Select
      showSearch
      autoFocus={autoFocus}
      value={value}
      placeholder="Search a task, ticket or project"
      aria-label="Work item"
      filterOption={false}
      onSearch={setSearch}
      notFoundContent={found.isFetching ? <Spin size="small" /> : "Nothing matches"}
      onChange={(next: string) =>
        onChange?.(next, items.find((item) => subjectKey(item.subject_type, item.subject_id) === next))
      }
      options={[
        ...(!q && items.some((item) => item.recent)
          ? [{
              label: "Recent",
              options: items
                .filter((item) => item.recent)
                .map((item) => ({ value: subjectKey(item.subject_type, item.subject_id), label: item.label })),
            }]
          : []),
        {
          label: q ? "Matches" : "Assigned to you",
          options: items
            .filter((item) => q || !item.recent)
            .map((item) => ({
              value: subjectKey(item.subject_type, item.subject_id),
              label: `${KIND_LABEL[item.subject_type]} · ${item.label}`,
            })),
        },
      ]}
      style={{ width: "100%" }}
    />
  );
}
