import { useQuery } from "@tanstack/react-query";
import { Select } from "antd";
import { useState } from "react";

import { explorerApi } from "@/api/explorer";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { asText } from "@/lib/text";
import { STALE, queryKeys } from "@/lib/queryKeys";

/** Customers by name, from the explorer — the same list the customers page reads. */
export function CustomerPicker({
  value,
  onChange,
  initialLabel,
}: {
  value?: string;
  onChange?: (value: string) => void;
  initialLabel?: string | null;
}) {
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term, 250);
  const results = useQuery({
    queryKey: queryKeys.contractCustomerPicker(debounced),
    queryFn: ({ signal }) =>
      explorerApi.query(
        { resource_type: "customer", columns: ["name", "code"], query_text: debounced || undefined, page_size: 20, sort: "name", order: "asc" },
        signal,
      ),
    staleTime: STALE.short,
  });
  const options = (results.data?.items ?? []).map((row) => ({
    value: asText(row.id),
    label: `${asText(row.name)} · ${asText(row.code)}`,
  }));
  if (value && initialLabel && !options.some((option) => option.value === value)) {
    options.unshift({ value, label: initialLabel });
  }
  return (
    <Select
      showSearch
      value={value}
      onChange={onChange}
      filterOption={false}
      onSearch={setTerm}
      options={options}
      loading={results.isFetching}
      placeholder="Search customers…"
      aria-label="Customer"
      data-testid="contract-customer"
    />
  );
}
