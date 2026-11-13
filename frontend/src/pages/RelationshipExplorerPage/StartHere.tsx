import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button, Card, List, Segmented, Skeleton } from "antd";
import { ApartmentOutlined } from "@ant-design/icons";

import { type RelatedNode } from "@/api/relationships";
import { searchApi } from "@/api/search";
import { PageHeader } from "@/components/PageHeader";
import { ConnectionMapView } from "@/components/relationships/ConnectionMapView";
import { NetworkView } from "@/components/relationships/NetworkView";
import { SimpleSearch } from "@/components/explorer/SimpleSearch";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { EmptyState } from "@/components/EmptyState";
import { queryKeys } from "@/lib/queryKeys";

/** The starting point: an analysis, with search over the top of it. */
export function StartHere({ onStart }: { onStart: (node: RelatedNode, entity: string) => void }) {
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term.trim(), 280);
  const results = useQuery({
    queryKey: queryKeys.globalSearch(debounced),
    queryFn: ({ signal }) => searchApi.global(debounced, signal),
    enabled: debounced.length >= 2,
  });
  const searching = debounced.length >= 2;

  // Both the analysis and its focus live in the URL, so "the customer
  // clusters" is a thing one person can send to another (§69).
  const analysis = params.get("view") === "map" ? "map" : "communities";
  const focus = params.get("focus") || "customer";
  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        Object.entries(changes).forEach(([key, value]) =>
          value === null ? next.delete(key) : next.set(key, value),
        );
        return next;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader
        title="Relationships"
        subtitle="How the platform's records cluster, and how its entities connect."
        actions={
          <Segmented
            data-testid="analysis-view"
            value={analysis}
            onChange={(next) => set({ view: next === "map" ? "map" : null })}
            options={[
              { label: "Communities", value: "communities" },
              { label: "Connection map", value: "map" },
            ]}
          />
        }
      />

      <Card size="small" className="nu-filter-bar">
        <SimpleSearch
          dataset="relationships"
          label="a record to start from"
          value={term}
          onChange={setTerm}
        />
      </Card>

      {/* Searching replaces the analysis rather than pushing it down the page:
          somebody who has typed a name is no longer reading the map. */}
      {searching ? (
        <>
          {results.isLoading && <Skeleton active paragraph={{ rows: 4 }} />}
          {results.data?.total === 0 && <EmptyState title={`Nothing matches “${debounced}”`} />}
          {results.data?.groups.map((group) => (
            <Card key={group.resource_type} size="small" title={group.label} className="nu-block">
              <List
                dataSource={group.items}
                renderItem={(hit) => (
                  <List.Item
                    className="nu-relation-item"
                    actions={[
                      <Button
                        key="start"
                        type="text"
                        icon={<ApartmentOutlined />}
                        onClick={() =>
                          onStart(
                            {
                              id: hit.id,
                              label: hit.label,
                              summary: hit.summary,
                              entity: hit.resource_type,
                              explorable: true,
                              updated_at: null,
                            },
                            hit.resource_type,
                          )
                        }
                      >
                        Start here
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta title={hit.label} description={hit.summary} />
                  </List.Item>
                )}
              />
            </Card>
          ))}
        </>
      ) : analysis === "map" ? (
        <ConnectionMapView
          onStart={(entity, id) =>
            onStart(
              { id, label: "", summary: "", entity, explorable: true, updated_at: null },
              entity,
            )
          }
        />
      ) : (
        <NetworkView
          focus={focus}
          onFocus={(next) => set({ focus: next === "customer" ? null : next })}
          onExplore={(entity, id) =>
            onStart(
              { id, label: "", summary: "", entity, explorable: true, updated_at: null },
              entity,
            )
          }
        />
      )}
    </>
  );
}
