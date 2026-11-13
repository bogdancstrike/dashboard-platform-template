/**
 * The plumbing every entity list repeats (§7), once: the dataset's view, its
 * rows, the record drawer that opens a new record on its own page, and the
 * bulk selection built from the list's own request.
 *
 * Like `useEntityView`, this owns no layout. A ledger, a queue, a card grid
 * and a fleet monitor each still decide what a row looks like; what they no
 * longer decide is how a list opens a record or what "select all" sends.
 */

import { useNavigate } from "react-router-dom";

import { useBulk, type Bulk } from "@/components/records/useBulk";
import { useRecordEditing, type RecordEditing } from "@/components/records/useRecordEditing";
import { useEntityView, type EntityView, type EntityViewOptions } from "@/entities/useEntityView";

export interface EntityList<Row> {
  view: EntityView;
  /** The current page's rows, typed by the page that asked for them. */
  rows: Row[];
  records: RecordEditing;
  /** Open one record's own page. */
  open: (id: string) => void;
  navigate: ReturnType<typeof useNavigate>;
}

export function useEntityList<Row>(
  resourceKey: string,
  /** Where a record's page lives — `/orders` opens `/orders/<id>`. */
  path: string,
  options: EntityViewOptions = {},
): EntityList<Row> {
  const navigate = useNavigate();
  const view = useEntityView(resourceKey, options);
  const rows = (view.rows.data?.items ?? []) as Row[];
  const open = (id: string) => navigate(`${path}/${id}`);
  const records = useRecordEditing(view.resource, { onCreated: open });
  return { view, rows, records, open, navigate };
}

/**
 * The list's own request is what "everything matching this filter" means,
 * sent unchanged — a hand-built copy of the filters would be a second
 * question, and rows nobody saw would change the first time the two differed.
 */
export function useEntityBulk(view: EntityView): Bulk {
  return useBulk(view.resource, {
    request: view.request,
    total: view.rows.data?.total ?? 0,
  });
}
