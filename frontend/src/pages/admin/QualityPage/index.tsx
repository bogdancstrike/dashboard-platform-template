/**
 * Data quality — what is wrong with the records, and where to go and fix it (§65).
 *
 * Every dataset in a real installation rots the same few ways: a customer
 * nobody owns, a ticket marked resolved with no moment of resolution, two
 * accounts with one email address. None of those is a bug in the software and
 * all of them break something downstream, so a platform that cannot show them
 * is one where somebody finds out from a customer.
 *
 * Four decisions worth the reader's attention.
 *
 * **Every count opens the rows it counted.** The check *is* the list's filter,
 * so the address is the same question — not a second query that will one day
 * disagree with the number beside it (§44).
 *
 * **The checks that cannot be a link say so.** `spent > budget` compares two
 * columns and a filter compares a column to a value; those findings name the
 * records instead, and the page explains why rather than hiding the difference
 * behind a link that would open the wrong rows.
 *
 * **The passing checks are drawn.** A page listing only problems cannot be told
 * apart from a page whose checks are broken. "14 checks, 8 with something in
 * them" is a sentence somebody can trust; a list of eight is not.
 *
 * **Each finding says what to do.** A finding with no remedy is a complaint,
 * and a page of complaints is a page nobody opens twice.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Segmented, Skeleton, Space, Tag, Typography } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";

import { qualityApi } from "@/api/quality";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { relativeTime } from "@/lib/time";
import { queryKeys } from "@/lib/queryKeys";

import { QualityReport } from "./QualityReport";
import { QualityTotals } from "./QualityTotals";
import { ranked } from "./qualityRank";

export { ranked, summarise } from "./qualityRank";

const { Text } = Typography;

export default function QualityPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const chosen = params.get("resource_type") ?? "";

  const query = useQuery({
    queryKey: queryKeys.quality(chosen),
    queryFn: ({ signal }) => qualityApi.overview({ resource_type: chosen }, signal),
  });
  const overview = query.data;

  usePageCommands("quality", [
    {
      id: "quality.all",
      label: "Show every dataset's data-quality checks",
      keywords: "quality data problems all",
      run: () => setParams(new URLSearchParams()),
    },
    {
      id: "quality.rerun",
      label: "Run the checks again",
      keywords: "refresh rerun recheck now generated",
      run: () => void query.refetch(),
    },
    {
      id: "quality.catalogue",
      label: "Read what each dataset declares",
      keywords: "catalog fields declaration schema types",
      run: () => navigate("/find/catalog"),
    },
  ]);

  const findings = useMemo(() => ranked(overview?.findings ?? []), [overview]);

  return (
    <div className="nx-ad nx-ad--quality">
      <PageHeader
        title={<>Data <em>quality</em></>}
        subtitle="What is wrong with the records, and where to go and fix it. Every count opens the rows behind it."
        tag={
          overview ? (
            <Tag data-testid="quality-generated">{relativeTime(overview.generated_at)}</Tag>
          ) : undefined
        }
      />

      {query.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : !overview ? (
        <EmptyState
          title="The checks could not be run"
          hint="Try again; if it keeps happening the reference on the error page will find it in the logs."
        />
      ) : (
        <>
          <QualityTotals overview={overview} />

          <Card size="small" className="nu-filter-bar nu-block">
            <Space size={10} wrap>
              <Text type="secondary">Dataset</Text>
              <Segmented
                value={chosen || "all"}
                onChange={(value) => {
                  const next = new URLSearchParams(params);
                  // In the URL, so a narrowed page is a link (§69) — and it is
                  // the address a list's own indicator points at.
                  if (value === "all") next.delete("resource_type");
                  else next.set("resource_type", String(value));
                  setParams(next, { replace: true });
                }}
                options={[
                  { value: "all", label: "Everything" },
                  ...overview.datasets.map((dataset) => ({
                    value: dataset.resource_type,
                    label: `${dataset.label}${dataset.failing ? ` · ${dataset.failing}` : ""}`,
                  })),
                ]}
                data-testid="quality-datasets"
              />
            </Space>
          </Card>

          <QualityReport overview={overview} findings={findings} />
        </>
      )}
    </div>
  );
}
