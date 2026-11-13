import { Tooltip } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { qualityApi } from "@/api/quality";
import { STALE, queryKeys } from "@/lib/queryKeys";

/**
 * "3 data issues", beside the count, on every list (§65).
 *
 * Here rather than on each page, so a dataset gets the indicator by being a
 * dataset. It is a *chip and a link* and nothing more: the explanations, the
 * remedies and the rows live on `/admin/quality`, and putting them on every
 * list would be that page rendered six times.
 *
 * Absent when there is nothing wrong, deliberately. A green "0 issues" on six
 * lists is six pieces of chrome a reader learns to skip, and then the one that
 * says 3 is skipped too.
 */
export function QualityChip({ resourceKey }: { resourceKey: string }) {
  const found = useQuery({
    queryKey: queryKeys.qualitySummary(resourceKey),
    queryFn: ({ signal }) => qualityApi.summary(resourceKey, signal),
    staleTime: STALE.minute,
  });
  const summary = found.data;
  if (!summary || summary.failing === 0) return null;

  return (
    <Tooltip
      title={`${summary.records.toLocaleString()} records across ${summary.failing} check${
        summary.failing === 1 ? "" : "s"
      }. Open the data-quality page to see what and why.`}
    >
      <Link
        to={`/admin/quality?resource_type=${resourceKey}`}
        className={`nx-rec-quality nx-rec-quality--${
          summary.worst === "CRITICAL" ? "bad" : summary.worst === "WARNING" ? "warn" : "acc"
        }`}
        data-testid="entity-quality"
      >
        {summary.failing} data {summary.failing === 1 ? "issue" : "issues"}
      </Link>
    </Tooltip>
  );
}
