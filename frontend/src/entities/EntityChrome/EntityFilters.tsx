import { Input, Select } from "antd";
import { SearchOutlined } from "@ant-design/icons";

import type { EntityView } from "@/entities/useEntityView";

/**
 * Search plus one select per faceted field.
 *
 * Facets rather than free selects: the options and their counts come from the
 * rows actually reachable under the other filters, so the menu can never offer
 * a value that finds nothing.
 */
export function EntityFilters({
  view,
  only,
  children,
}: {
  view: EntityView;
  /** Restrict to these fields — a triage queue wants two, not six. */
  only?: string[];
  children?: React.ReactNode;
}) {
  const { resource, rows, filters, search, setSearch, setFilter } = view;
  const fields = (resource?.fields ?? []).filter(
    (field) => field.facet && (!only || only.includes(field.name)),
  );

  return (
    <div className="nu-filter-bar nx-rec-filters" role="search">
      <Input
        allowClear
        prefix={<SearchOutlined aria-hidden />}
        placeholder={`Search ${resource?.label.toLowerCase() ?? ""}`}
        aria-label={`Search ${resource?.label.toLowerCase() ?? ""}`}
        className="nx-rec-search"
        variant="filled"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="nx-rec-facets">
        {fields.map((field) => (
          <Select
            key={field.name}
            allowClear
            showSearch
            variant="filled"
            placeholder={field.label}
            aria-label={field.label}
            popupMatchSelectWidth={false}
            className={`nx-rec-facet${filters[field.name] ? " is-set" : ""}`}
            value={filters[field.name] ?? undefined}
            options={(rows.data?.facets[field.name] ?? []).map((facet) => ({
              value: facet.value,
              label: `${facet.value} · ${facet.count.toLocaleString()}`,
            }))}
            onChange={(value?: string) => setFilter(field.name, value ?? null)}
          />
        ))}
        {children}
      </div>
    </div>
  );
}
