/**
 * Find a record to mention or link (§48) — through global search, so it finds
 * whatever the reader would find on `/find/global` and nothing they could not.
 */

import { useQuery } from "@tanstack/react-query";
import { Input, Modal, Skeleton } from "antd";
import { useState } from "react";

import { searchApi } from "@/api/search";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

import { RECORD_PATHS } from "./blocks";
import { EmptyState } from "@/components/EmptyState";
import { queryKeys } from "@/lib/queryKeys";

export interface PickedRecord {
  resource_type: string;
  id: string;
  label: string;
}

export function RecordPicker({
  open,
  onClose,
  onPick,
  title = "Choose a record",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (record: PickedRecord) => void;
  title?: string;
}) {
  const [term, setTerm] = useState("");
  const query = useDebouncedValue(term.trim(), 250);
  const results = useQuery({
    queryKey: queryKeys.globalSearch("picker", query),
    queryFn: ({ signal }) => searchApi.global(query, signal),
    enabled: open && query.length >= 2,
  });
  const groups = (results.data?.groups ?? []).filter((group) => group.resource_type in RECORD_PATHS);
  return (
    <Modal open={open} title={title} onCancel={onClose} footer={null} destroyOnHidden>
      <Input.Search
        autoFocus
        allowClear
        placeholder="Search tasks, tickets, projects, customers, orders, devices…"
        aria-label="Search records"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        data-testid="record-search"
      />
      <div className="nx-dc-picker">
        {query.length < 2 ? (
          <p className="nx-co-muted">Type at least two letters.</p>
        ) : results.isLoading ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : groups.length === 0 ? (
          <EmptyState compact title="Nothing matched" />
        ) : (
          groups.map((group) => (
            <section key={group.resource_type}>
              <h5>{group.label}</h5>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onPick({ resource_type: group.resource_type, id: item.id, label: item.label })}
                    >
                      <strong>{item.label}</strong>
                      {item.summary && <span className="nx-co-muted">{item.summary}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </Modal>
  );
}
