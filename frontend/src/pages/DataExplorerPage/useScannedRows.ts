import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { ExplorerRequest, ExplorerResult, ExplorerView } from "@/api/explorer";
import type { ExplorerRecord } from "@/components/explorer/ExplorerResults";

export function useScannedRows(
  view: ExplorerView,
  request: ExplorerRequest | null,
  results: UseQueryResult<ExplorerResult>,
) {
  /**
   * List and card modes accumulate pages instead of replacing them (§52).
   *
   * The rows are held here rather than in the results component so that
   * changing the question — a new term, another filter — throws them away: a
   * "load more" that keeps rows from a question nobody is asking any more is
   * a list that quietly mixes two answers.
   */
  const scanning = view === "list" || view === "cards";
  const [scanned, setScanned] = useState<ExplorerRecord[]>([]);
  const questionKey = JSON.stringify({ ...request, page: undefined });

  useEffect(() => {
    setScanned([]);
  }, [questionKey, scanning]);

  useEffect(() => {
    if (!scanning || !results.data) return;
    setScanned((current) => {
      if (results.data.page === 1) return results.data.items;
      const seen = new Set(current.map((row) => row.id));
      return [...current, ...results.data.items.filter((row) => !seen.has(row.id))];
    });
  }, [scanning, results.data]);

  return { scanning, scanned };
}
