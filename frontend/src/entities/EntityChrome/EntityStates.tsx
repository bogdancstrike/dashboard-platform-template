import { Card } from "antd";

import { EmptyState, NoResults } from "@/components/EmptyState";
import { FailureAlert } from "@/components/FailureAlert";
import type { EntityView } from "@/entities/useEntityView";

/**
 * Which of the four things a list with no rows should say (§34).
 *
 * Six lists each wrote this ternary for themselves and all six wrote the same
 * three branches — loading, nothing-matched, nothing-yet — and all six forgot
 * the fourth: a list whose query was *refused* drew the failure alert and then
 * "No orders have been placed yet" underneath it, which tells the reader in
 * one screen both that they may not see the dataset and that it is empty.
 *
 * The branch is the contract and lives here; the sentences belong to the page,
 * because only it knows what an order is. When the query failed this renders
 * nothing at all: `EntityError` above has already said what happened, and a
 * second voice guessing at the same event is how the contradiction got there.
 */
export function EntityEmpty({
  view,
  title,
  hint,
  action,
  card = false,
}: {
  view: EntityView;
  /** "No orders have been placed yet" — the page's own words. */
  title: string;
  hint?: React.ReactNode;
  /** Usually the control that makes the first one (§34). */
  action?: React.ReactNode;
  /** Wrap it in a card, for the lists whose rows are not a table. */
  card?: boolean;
}) {
  if (view.rows.isError || view.catalogue.isError) return null;
  // A blank rather than AntD's "No data", which would flash under the skeleton
  // for as long as the first query takes.
  if (view.rows.isLoading) return <> </>;

  const message =
    view.filterCount > 0 ? (
      <NoResults filterCount={view.filterCount} onClear={view.clearFilters} />
    ) : (
      <EmptyState title={title} hint={hint} action={action} guide={view.resource?.key} />
    );

  return card ? (
    <Card size="small" className="nu-block">
      {message}
    </Card>
  ) : (
    message
  );
}

/** One place where a dataset that will not load says why (§34, §76). */
export function EntityError({ view }: { view: EntityView }) {
  if (!view.rows.isError && !view.catalogue.isError) return null;

  return (
    <FailureAlert
      className="nu-block"
      error={view.rows.error ?? view.catalogue.error}
      titles={{
        forbidden: "Your role does not include this dataset",
        not_found: "That dataset no longer exists",
        failed: "Those records could not be loaded",
      }}
      onRetry={() => void view.rows.refetch()}
    />
  );
}
