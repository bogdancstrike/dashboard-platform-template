import { useQuery } from "@tanstack/react-query";
import { Select } from "antd";
import { useState } from "react";

import { explorerApi } from "@/api/explorer";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { STALE, queryKeys } from "@/lib/queryKeys";

/**
 * Pick a record from the dataset a foreign key points at.
 *
 * Searched on the server, like the people picker and for the same reason: a
 * control that filters the first fifty rows it downloaded cannot find the
 * project whose name starts with "W".
 */
export function RecordPicker({
  resourceType,
  label,
  value,
  onChange,
}: {
  resourceType: string;
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term, 250);

  const results = useQuery({
    queryKey: queryKeys.recordPicker(resourceType, debounced, value),
    queryFn: ({ signal }) =>
      explorerApi.query(
        {
          resource_type: resourceType,
          query_text: debounced,
          filters: {},
          page: 1,
          page_size: 20,
        },
        signal,
      ),
    staleTime: STALE.short,
  });

  const options = (results.data?.items ?? []).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      value: String(item.id),
      label: String(item.name ?? item.title ?? item.subject ?? item.reference ?? item.code ?? item.id),
    };
  });
  // A stored id has to keep rendering while the search term moves on, even if
  // the current page of results no longer contains it.
  if (value && !options.some((option) => option.value === value)) {
    options.unshift({ value, label: value });
  }

  return (
    <Select
      showSearch
      allowClear
      aria-label={label}
      placeholder={`Search ${resourceType}s`}
      loading={results.isFetching}
      value={value}
      searchValue={term}
      onSearch={setTerm}
      filterOption={false}
      notFoundContent={results.isFetching ? "Searching…" : "Nothing by that name"}
      options={options}
      onChange={(next: string | undefined) => onChange(next ?? undefined)}
    />
  );
}
