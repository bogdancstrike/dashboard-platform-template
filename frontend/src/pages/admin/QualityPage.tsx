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
import { Alert, Card, Segmented, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
import { CheckCircleOutlined } from "@ant-design/icons";
import { Link, useSearchParams } from "react-router-dom";

import type { QualityFinding, QualityOverview, QualitySeverity } from "@/api/quality";
import { qualityApi } from "@/api/quality";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { usePageCommands } from "@/commands/CommandContext";
import { formatNumber } from "@/lib/formats";
import { relativeTime } from "@/lib/time";
import { withOrigin } from "@/entities/drilldown";

const { Text, Paragraph } = Typography;

/**
 * Severity → the AntD tag preset that carries it.
 *
 * A preset rather than one of our own hexes, for the reason the dashboard's
 * alert tags are: a custom colour makes AntD write white on the fill, and white
 * on our amber is 2.87:1 (§55).
 */
export const SEVERITY_TONE: Record<QualitySeverity, string> = {
  CRITICAL: "error",
  WARNING: "warning",
  INFO: "processing",
};

/**
 * The order findings are read in.
 *
 * By severity first and *count second*, because one contradiction matters more
 * than four hundred missing phone numbers — sorting by count would bury the
 * order that shipped and was never paid under the devices that are merely
 * quiet.
 */
const RANK: Record<QualitySeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

export function ranked(findings: QualityFinding[]): QualityFinding[] {
  return [...findings].sort(
    (left, right) => RANK[left.severity] - RANK[right.severity] || right.count - left.count,
  );
}

/** What the page says it looked at, in one sentence. */
export function summarise(overview: QualityOverview | undefined): string {
  if (!overview) return "";
  const { checks, failing, records } = overview.totals;
  if (failing === 0) {
    return `${checks} checks, and nothing to report`;
  }
  return `${checks} checks · ${failing} with something in them · ${formatNumber(records)} records`;
}

export default function QualityPage() {
  const [params, setParams] = useSearchParams();
  const chosen = params.get("resource_type") ?? "";

  const query = useQuery({
    queryKey: ["quality", chosen],
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
  ]);

  const findings = useMemo(() => ranked(overview?.findings ?? []), [overview]);
  const failing = findings.filter((finding) => finding.count > 0);
  const passing = findings.filter((finding) => finding.count === 0);

  return (
    <>
      <PageHeader
        title="Data quality"
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
          <div className="nu-quality-totals" data-testid="quality-totals">
            <StatCard
              label="Checks run"
              value={overview.totals.checks}
              hint="Every dataset, every rule"
              accent="neutral"
            />
            <StatCard
              label="With something in them"
              value={overview.totals.failing}
              hint={summarise(overview)}
              accent={overview.totals.failing > 0 ? "warning" : "success"}
            />
            <StatCard
              label="Contradictions"
              value={overview.totals.by_severity.CRITICAL}
              hint="A state that cannot be true"
              accent={overview.totals.by_severity.CRITICAL > 0 ? "danger" : "success"}
            />
            <StatCard
              label="Records involved"
              value={overview.totals.records}
              displayValue={formatNumber(overview.totals.records)}
              accent="accent"
            />
          </div>

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

          {failing.length === 0 ? (
            <Alert
              type="success"
              showIcon
              icon={<CheckCircleOutlined />}
              data-testid="quality-clean"
              message="Nothing to report"
              description={`All ${overview.totals.checks} checks came back empty. The checks themselves are listed below, so this is a clean bill rather than a page that failed to look.`}
            />
          ) : (
            <div className="nu-quality-list" data-testid="quality-findings">
              {failing.map((finding) => (
                <Finding key={finding.key} finding={finding} />
              ))}
            </div>
          )}

          {passing.length > 0 && (
            <Card
              size="small"
              className="nu-block"
              title={`${passing.length} checks with nothing in them`}
              data-testid="quality-passing"
            >
              {/* Drawn, because a page listing only problems cannot be told
                  apart from a page whose checks are broken. */}
              <Space size={[6, 6]} wrap>
                {passing.map((finding) => (
                  <Tooltip key={finding.key} title={finding.why}>
                    <Tag icon={<CheckCircleOutlined />}>
                      {finding.resource_label}: {finding.title}
                    </Tag>
                  </Tooltip>
                ))}
              </Space>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function Finding({ finding }: { finding: QualityFinding }) {
  return (
    <Card
      size="small"
      className="nu-quality-card"
      data-testid={`quality-${finding.key}`}
      title={
        <Space size={8} wrap>
          <Tag color={SEVERITY_TONE[finding.severity]}>{finding.severity}</Tag>
          <Text strong>{finding.title}</Text>
          <Text type="secondary">{finding.resource_label}</Text>
        </Space>
      }
      extra={
        finding.link ? (
          // The count *is* the link: the check is declared as the list's own
          // filter, so this opens exactly the rows that were counted (§44).
          <Link
            to={withOrigin(finding.link, "/admin/quality")}
            data-testid={`quality-open-${finding.key}`}
          >
            Open {formatNumber(finding.count)}
          </Link>
        ) : (
          <Text strong>{formatNumber(finding.count)}</Text>
        )
      }
    >
      <Paragraph className="nu-quality-why">{finding.why}</Paragraph>
      <Paragraph type="secondary" className="nu-quality-fix">
        <Text strong>What to do: </Text>
        {finding.fix}
      </Paragraph>

      {!finding.link && (
        <>
          <Text type="secondary" className="nu-quality-nolink">
            {finding.why_no_link}
          </Text>
          <ul className="nu-quality-sample" data-testid={`quality-sample-${finding.key}`}>
            {finding.sample.map((entry) => (
              <li key={entry.id}>
                <Link to={entry.path}>{entry.label}</Link>
              </li>
            ))}
            {finding.count > finding.sample.length && (
              <li>
                <Text type="secondary">
                  and {formatNumber(finding.count - finding.sample.length)} more
                </Text>
              </li>
            )}
          </ul>
        </>
      )}
    </Card>
  );
}
