import { Select } from "antd";

import { ListBar } from "@/components/listing/ListBar";

import type { useUsersPage } from "./useUsersPage";

/** `SUSPENDED` → "Suspended", for the quick-filter chips. */
function chipLabel(status: string): string {
  const words = status.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const STATUS_DOT: Record<string, string> = {
  ACTIVE: "ok",
  INVITED: "acc",
  SUSPENDED: "warn",
  DEACTIVATED: "bad",
  DISABLED: "bad",
  LOCKED: "bad",
};

type Page = ReturnType<typeof useUsersPage>;

/** Search, role and status, in the address. */
export function UserFilters({ page }: { page: Page }) {
  const { search, setSearch, roleCode, status, set, people } = page;
  const roleOptions = (people.data?.facets["role_code"] ?? []).map((facet) => ({
    value: facet.value,
    label: `${facet.value} · ${facet.count}`,
  }));
  const statusOptions = (people.data?.facets["status"] ?? []).map((facet) => ({
    value: facet.value,
    label: `${facet.value} · ${facet.count}`,
  }));
  return (
    <ListBar
      data-testid="user-filters"
      search={{
        placeholder: "Search people by name, email or username",
        "aria-label": "Search people",
        value: search,
        onChange: (event) => setSearch(event.target.value),
      }}
    >
      <Select
        allowClear
        placeholder="Role: any"
        aria-label="Role"
        className={roleCode ? "nx-ad-set" : undefined}
        popupMatchSelectWidth={false}
        style={{ minWidth: 150 }}
        value={roleCode || undefined}
        options={roleOptions}
        onChange={(value?: string) => set({ role_code: value ?? null, page: null })}
      />
      <Select
        allowClear
        placeholder="Status: any"
        aria-label="Status"
        className={status ? "nx-ad-set" : undefined}
        popupMatchSelectWidth={false}
        style={{ minWidth: 150 }}
        value={status || undefined}
        options={statusOptions}
        onChange={(value?: string) => set({ status: value ?? null, page: null })}
      />
    </ListBar>
  );
}

/** Every status with its count; a second press lets go. */
export function StatusChips({ page }: { page: Page }) {
  const { status, set, people } = page;
  const statusFacets = people.data?.facets["status"] ?? [];
  const everyone = statusFacets.reduce((sum, facet) => sum + facet.count, 0);
  if (statusFacets.length === 0) return null;
  return (
    <div className="nx-ad-segs" role="group" aria-label="Quick filters">
      <button
        type="button"
        className="nx-ad-seg"
        aria-pressed={!status}
        onClick={() => set({ status: null, page: null })}
      >
        <i />
        All<b>{everyone.toLocaleString()}</b>
      </button>
      {statusFacets.map((facet) => (
        <button
          key={facet.value}
          type="button"
          className="nx-ad-seg"
          aria-pressed={status === facet.value}
          onClick={() => set({ status: status === facet.value ? null : facet.value, page: null })}
        >
          <i className={`nx-ad-dot--${STATUS_DOT[facet.value] ?? "acc"}`} />
          {chipLabel(facet.value)}
          <b>{facet.count.toLocaleString()}</b>
        </button>
      ))}
    </div>
  );
}
