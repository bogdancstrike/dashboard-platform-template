import { Pagination } from "antd";

import type { EntityView } from "@/entities/useEntityView";

import { showRange } from "./paging";

/**
 * The pager under a list whose rows are cards rather than a table — shown only
 * when there is more than one page, and writing the default size as nothing.
 */
export function EntityPager({
  view,
  defaultPageSize,
  pageSizeOptions,
}: {
  view: EntityView;
  defaultPageSize: number;
  pageSizeOptions: number[];
}) {
  if ((view.rows.data?.total ?? 0) <= view.pageSize) return null;
  return (
    <div className="nu-notice-pager">
      <Pagination
        current={view.page}
        pageSize={view.pageSize}
        total={view.rows.data?.total ?? 0}
        showSizeChanger
        pageSizeOptions={pageSizeOptions}
        showTotal={showRange}
        onChange={(next, size) =>
          view.set({ page: next === 1 ? null : next, page_size: size === defaultPageSize ? null : size })
        }
      />
    </div>
  );
}
