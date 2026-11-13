/** How an entity list's table and pager write their page, size and sort to the address. */

import type { TablePaginationConfig } from "antd/es/table";
import type { SorterResult } from "antd/es/table/interface";

import type { EntityView } from "@/entities/useEntityView";

/** "1–25 of 1,204" under every list. */
export const showRange = (count: number, range: [number, number]) =>
  `${range[0]}–${range[1]} of ${count.toLocaleString()}`;

/**
 * A table's change event as address changes. The default size and the first
 * page are written as nothing, so a plain list keeps a plain address.
 */
export function tableChange<Row>(view: EntityView, defaultPageSize = 25) {
  return (
    pagination: TablePaginationConfig,
    _filters: unknown,
    sorter: SorterResult<Row> | SorterResult<Row>[],
  ) => {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof single?.field === "string" ? single.field : view.sort;
    view.set({
      page: pagination.current === 1 ? null : (pagination.current ?? null),
      page_size: pagination.pageSize === defaultPageSize ? null : (pagination.pageSize ?? null),
      sort: single?.order ? field : null,
      order: single?.order === "ascend" ? "asc" : null,
    });
  };
}

/** The table's pager, reading the page the server answered for. */
export function tablePagination(view: EntityView, pageSizeOptions: number[]): TablePaginationConfig {
  return {
    current: view.rows.data?.page ?? view.page,
    pageSize: view.rows.data?.page_size ?? view.pageSize,
    total: view.rows.data?.total ?? 0,
    showSizeChanger: true,
    pageSizeOptions,
    showTotal: showRange,
  };
}
