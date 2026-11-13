/** The shared list-page plumbing: data, table, pager. Layout stays with each page. */

export { useEntityBulk, useEntityList, type EntityList } from "./useEntityList";
export { EntityTable } from "./EntityTable";
export { EntityPager } from "./EntityPager";
export { showRange, tableChange, tablePagination } from "./paging";
