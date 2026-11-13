/**
 * Global search (§32) — one term, every dataset, ranked against each other.
 *
 * The question this answers is not "which tasks match?" but "where does this
 * appear at all?", which is what somebody has when they hold a reference
 * number and do not know which screen it belongs to. So results are grouped by
 * dataset, the strongest group first, and every hit says which field matched
 * and shows the text around it.
 *
 * It is keyboard-first, because that is how the question is usually asked:
 * arrow keys walk the flattened result list across group boundaries and Enter
 * opens the highlighted one, without the reader's hand leaving the box.
 */

import { Alert } from "antd";

import { PageHeader } from "@/components/PageHeader";

import { MIN_TERM } from "./searchConsts";

import { SearchBar } from "./SearchBar";
import { SearchResults } from "./SearchResults";
import { useGlobalSearch } from "./useGlobalSearch";

export default function GlobalSearchPage() {
  const m = useGlobalSearch();
  const { term, results, tooShort, groups } = m;

  return (
    <div className="nx-fd-global">
      <PageHeader
        title="Search"
        subtitle={
          results.data && term.trim()
            ? `“${results.data.query}” · ${results.data.total} ${results.data.total === 1 ? "result" : "results"} across ${groups.length} record ${groups.length === 1 ? "type" : "types"}`
            : "One term across every dataset you can read, ranked by how well it matched."
        }
        tag={
          results.data && results.data.total > 0 ? (
            <span className="nx-fd-sr" data-testid="global-total">
              {results.data.total} {results.data.total === 1 ? "result" : "results"}
            </span>
          ) : undefined
        }
      />

      <SearchBar m={m} />

      {results.isError && (
        <Alert
          type="error"
          showIcon
          message="The search could not be run"
          description={results.error instanceof Error ? results.error.message : "Unknown error"}
        />
      )}

      {tooShort && (
        <Alert type="info" showIcon message={`Type at least ${MIN_TERM} characters to search.`} />
      )}

      <SearchResults m={m} />
    </div>
  );
}
