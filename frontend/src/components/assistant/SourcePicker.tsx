import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Popover, Skeleton, Typography } from "antd";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import type { AssistantSources } from "@/api/assistant";
import { knowledgeApi } from "@/api/knowledge";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

export const DEFAULT_SOURCES: AssistantSources = { records: true, collections: [], documents: [] };

/** "Records · 2 collections" — what the button says the turn will read. */
export function describeSources(sources: AssistantSources, names: Record<string, string> = {}): string {
  const parts: string[] = [];
  if (sources.records) parts.push("Records");
  if (sources.collections.length === 1) parts.push(names[sources.collections[0]!] ?? "1 collection");
  else if (sources.collections.length > 1) parts.push(`${sources.collections.length} collections`);
  if (sources.documents.length) parts.push(`${sources.documents.length} file${sources.documents.length === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Nothing";
}

/**
 * What a Data-mode answer may read (§41, §44): the reader's records and/or
 * document collections, or only some files of a collection — the way
 * Horizon's Ask lets a conversation be scoped to data sources.
 *
 * Choosing no file of a collection means the whole collection. At least one
 * source must stay chosen; the server checks the collections are visible.
 */
export function SourcePicker({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: AssistantSources;
  onChange: (next: AssistantSources) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["knowledge-collections"],
    queryFn: ({ signal }) => knowledgeApi.list({}, signal),
    staleTime: 60_000,
  });
  const files = useQuery({
    queryKey: ["knowledge-collection", expanded],
    queryFn: ({ signal }) => knowledgeApi.get(expanded!, signal),
    enabled: Boolean(expanded),
  });
  const collections = (list.data?.items ?? []).filter((c) => c.counts.ready > 0);
  const names = Object.fromEntries((list.data?.items ?? []).map((c) => [c.id, c.name]));

  const set = (next: Partial<AssistantSources>) => {
    const merged = { ...value, ...next };
    if (!merged.records && merged.collections.length === 0) return; // keep one source
    onChange(merged);
  };
  const toggleCollection = (id: string, checked: boolean) => {
    const ids = checked ? [...value.collections, id] : value.collections.filter((c) => c !== id);
    const keep = checked ? value.documents : value.documents.filter((d) => !(files.data?.id === id && files.data.documents.some((doc) => doc.id === d)));
    set({ collections: ids, documents: keep });
  };
  const toggleFile = (collectionId: string, documentId: string, checked: boolean) => {
    const documents = checked ? [...value.documents, documentId] : value.documents.filter((d) => d !== documentId);
    const collections = value.collections.includes(collectionId) ? value.collections : [...value.collections, collectionId];
    set({ documents, collections });
  };

  const content = (
    <div className="nx-ai-sources" data-testid="assistant-sources-panel">
      <Checkbox
        checked={value.records}
        onChange={(event) => set({ records: event.target.checked })}
        data-testid="source-records"
      >
        <b>My records</b> <Text type="secondary">— projects, customers, orders, tickets, tasks, devices</Text>
      </Checkbox>
      <div className="nx-ai-sources-title">Document collections</div>
      {list.isLoading && <Skeleton active paragraph={{ rows: 2 }} title={false} />}
      {!list.isLoading && collections.length === 0 && (
        <EmptyState
          compact
          title={
            <span>
              No collection with read documents yet. <Link to="/ai/documents">Add some</Link>.
            </span>
          }
        />
      )}
      <ul className="nx-ai-sources-list">
        {collections.map((collection) => {
          const isOpen = expanded === collection.id;
          const chosen = value.collections.includes(collection.id);
          return (
            <li key={collection.id}>
              <div className="nx-ai-sources-row">
                <Button
                  type="text"
                  shape="circle"
                  aria-label={`${isOpen ? "Hide" : "Show"} files of ${collection.name}`}
                  icon={isOpen ? <DownOutlined /> : <RightOutlined />}
                  onClick={() => setExpanded(isOpen ? null : collection.id)}
                />
                <Checkbox
                  checked={chosen}
                  onChange={(event) => toggleCollection(collection.id, event.target.checked)}
                  data-testid="source-collection"
                >
                  <span className="nx-ai-sources-dot" style={{ background: collection.color }} />
                  {collection.name}{" "}
                  <Text type="secondary">
                    · {collection.counts.ready} file{collection.counts.ready === 1 ? "" : "s"}
                  </Text>
                </Checkbox>
              </div>
              {isOpen && (
                <div className="nx-ai-sources-files">
                  {files.isLoading && <Skeleton active paragraph={{ rows: 2 }} title={false} />}
                  {files.data?.documents
                    .filter((doc) => doc.status === "READY")
                    .map((doc) => (
                      <Checkbox
                        key={doc.id}
                        checked={value.documents.includes(doc.id)}
                        onChange={(event) => toggleFile(collection.id, doc.id, event.target.checked)}
                        data-testid="source-file"
                      >
                        {doc.file.name}
                        {doc.pages ? <Text type="secondary"> · {doc.pages} p.</Text> : null}
                      </Checkbox>
                    ))}
                  <Text type="secondary" className="nx-ai-sources-hint">
                    No file ticked means the whole collection.
                  </Text>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={setOpen} placement="bottomLeft" arrow={false}>
      <Button disabled={disabled} data-testid="assistant-sources" className={`nx-ai-sources-button${compact ? " is-compact" : ""}`}>
        Sources: {describeSources(value, names)} <DownOutlined />
      </Button>
    </Popover>
  );
}
