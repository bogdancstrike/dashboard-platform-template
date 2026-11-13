import { Input, Select, Skeleton } from "antd";
import { SearchOutlined } from "@ant-design/icons";

import { EmptyState } from "@/components/EmptyState";

import { CollectionRow } from "../parts/CollectionRow";
import type { DocumentsPageData } from "../useDocumentsPage";

/** The collections: a select on a phone, a list beside the detail elsewhere. */
export function CollectionPicker({ page }: { page: DocumentsPageData }) {
  const { phone, term, setTerm, list, collections, activeId, visible, select, canCreate } = page;
  return (
    <>
      {phone ? (
        <Select
          className="nx-kn-picker"
          value={activeId ?? undefined}
          onChange={(id) => select(id)}
          placeholder="Choose a collection"
          aria-label="Collection"
          options={collections.map((c) => ({ value: c.id, label: c.name }))}
          data-testid="collection-picker"
        />
      ) : (
        <aside className="nx-kn-side nx-glass" data-testid="collection-list">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Find a collection"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
          {list.isLoading && <Skeleton active paragraph={{ rows: 4 }} />}
          {!list.isLoading && !visible.length && (
            <EmptyState
              compact
              title={collections.length ? "No collection matches" : "No collections yet"}
              hint={
                canCreate
                  ? "Create one and drop in the files people ask about."
                  : "Nobody has shared one with you yet."
              }
            />
          )}
          <ul className="nx-kn-collections">
            {visible.map((item) => (
              <CollectionRow
                key={item.id}
                item={item}
                active={item.id === activeId}
                onSelect={() => select(item.id)}
              />
            ))}
          </ul>
        </aside>
      )}
    </>
  );
}
