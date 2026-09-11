/**
 * Two or more records side by side, with the differences marked (§47).
 *
 * The question this answers is "what is actually different about these", and it
 * is asked most often about records somebody suspects are the same thing twice
 * — two customers with one email address, two orders for the same basket, two
 * tickets about one fault. `/admin/quality` finds those; this is where a reader
 * goes to decide what to do about them.
 *
 * Three decisions worth the reader's attention.
 *
 * **The fields that agree are shown by default.** They are the evidence that
 * two records are the same thing, and a view that only ever shows differences
 * cannot answer "are these duplicates" — which is the question. Hiding them is
 * one click, and the click says how many it hid.
 *
 * **A differing row is marked, not merely different.** Colour alone is not a
 * signal (§64): the row carries a marker and a title, and the count at the top
 * says how many rows to look for.
 *
 * **It is reached from a selection.** Comparison needs records chosen, and the
 * bulk bar is where a reader chooses them — so the entry point is there rather
 * than a button on a page that would have to ask "which ones?".
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Segmented, Skeleton, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import type { ComparedField, Comparison } from "@/api/compare";
import { compareApi } from "@/api/compare";
import { ApiError } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusTag } from "@/components/StatusTag";
import { usePageCommands } from "@/commands/CommandContext";
import { asText } from "@/lib/text";
import { formatNumber } from "@/lib/formats";

const { Text } = Typography;

/** What the reader is looking at, in one sentence. */
export function summarise(comparison: Comparison | undefined): string {
  if (!comparison) return "";
  const { records, differing, same } = comparison;
  if (differing === 0) {
    return `${records.length} ${comparison.resource_label.toLowerCase()} — identical in all ${same} fields`;
  }
  return `${records.length} ${comparison.resource_label.toLowerCase()} · ${differing} field${
    differing === 1 ? "" : "s"
  } differ · ${same} the same`;
}

/** The ids to compare, from the address. Order is the reader's. */
export function idsFrom(raw: string | null): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((piece) => piece.trim())
        .filter(Boolean),
    ),
  ];
}

export default function ComparePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const resourceType = params.get("type") ?? "";
  const ids = useMemo(() => idsFrom(params.get("ids")), [params]);
  const [show, setShow] = useState<"differences" | "everything">("differences");

  const query = useQuery({
    queryKey: ["compare", resourceType, ids],
    queryFn: ({ signal }) => compareApi.records(resourceType, ids, signal),
    enabled: Boolean(resourceType) && ids.length >= 2,
  });
  const comparison = query.data;

  usePageCommands("compare", [
    {
      id: "compare.show",
      label:
        show === "everything"
          ? "Show only the fields that differ"
          : "Show the fields that are the same as well",
      keywords: "compare all fields same identical differences only",
      // One command that toggles rather than two that each only work in one
      // direction: a palette offering "show everything" while everything is
      // already shown is a palette that has stopped reading the page.
      run: () => setShow(show === "everything" ? "differences" : "everything"),
    },
    {
      id: "compare.back",
      label: `Back to the ${resourceType} list`,
      keywords: "list records explorer return selection",
      run: () => navigate(`/explore?resource=${resourceType}`),
    },
    ...(ids.length > 0
      ? [
          {
            id: "compare.copy",
            label: "Copy a link to this comparison",
            keywords: "share link url send colleague",
            // The address *is* the comparison — the ids are in it — which is
            // the whole reason this page has no state of its own to share.
            run: () => void navigator.clipboard?.writeText(window.location.href),
          },
        ]
      : []),
  ]);

  const rows = useMemo(
    () =>
      (comparison?.fields ?? []).filter(
        (field) => show === "everything" || field.differs,
      ),
    [comparison, show],
  );

  const columns: ColumnsType<ComparedField> = useMemo(() => {
    if (!comparison) return [];
    return [
      {
        title: "Field",
        dataIndex: "label",
        width: 190,
        render: (label: string, field) => (
          <Space size={6}>
            <Text strong={field.differs}>{label}</Text>
            {/* A marker as well as the colour: colour alone is not a signal
                (§64), and this is the only thing distinguishing the rows a
                reader came here to find. */}
            {field.differs && (
              <Tag color="warning" title="These records disagree about this field">
                differs
              </Tag>
            )}
          </Space>
        ),
      },
      ...comparison.records.map((record, index) => ({
        title: (
          <Link to={record.path}>
            {record.title}
            {record.status ? <StatusTag status={record.status} /> : null}
          </Link>
        ),
        key: record.id,
        render: (_: unknown, field: ComparedField) => {
          const value = field.values[index];
          return value === null || value === "" || value === undefined ? (
            <Text type="secondary">—</Text>
          ) : (
            <span>{asText(value)}</span>
          );
        },
      })),
    ];
  }, [comparison]);

  if (!resourceType || ids.length < 2) {
    return (
      <>
        <PageHeader title="Compare records" />
        <EmptyState
          title="Choose at least two records"
          hint="Tick them on a list and use Compare on the selection bar. One record compared with nothing is its own page."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Compare ${comparison?.resource_label.toLowerCase() ?? "records"}`}
        subtitle={summarise(comparison)}
        actions={
          comparison ? (
            <Link to={comparison.path}>Back to the list</Link>
          ) : undefined
        }
      />

      {query.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : query.error instanceof ApiError ? (
        <Alert
          type="warning"
          showIcon
          data-testid="compare-refused"
          message={query.error.message}
          description={
            <Link to="/">Choose a different selection and try again.</Link>
          }
        />
      ) : !comparison ? (
        <EmptyState title="That comparison could not be loaded" />
      ) : (
        <>
          {comparison.differing === 0 && (
            <Alert
              type="info"
              showIcon
              className="nu-block"
              data-testid="compare-identical"
              message="These records agree about every field"
              description="Every declared field holds the same value in all of them, which is the strongest evidence there is that they are the same thing recorded twice."
            />
          )}

          <Card size="small" className="nu-filter-bar nu-block">
            <Space size={10} wrap>
              <Text type="secondary">Show</Text>
              <Segmented
                value={show}
                onChange={(value) => setShow(value as "differences" | "everything")}
                options={[
                  {
                    value: "differences",
                    label: `Differences (${formatNumber(comparison.differing)})`,
                  },
                  {
                    // The fields that agree are the evidence two records are
                    // the same thing, so they are one click away rather than
                    // absent.
                    value: "everything",
                    label: `Every field (${formatNumber(
                      comparison.differing + comparison.same,
                    )})`,
                  },
                ]}
                data-testid="compare-show"
              />
            </Space>
          </Card>

          <Card size="small" className="nu-block">
            {/* Scrolled by its own container rather than by AntD's `scroll.x`.
                That prop makes AntD render a hidden measurement row which
                *duplicates the header nodes* — so the record links appeared
                twice, the second copy inside an `aria-hidden` row a keyboard
                could still tab into. axe called it `aria-hidden-focus`, and it
                was right: two invisible links is exactly the trap that rule
                exists to catch. A `div` with `overflow-x: auto` is the same
                behaviour with no second copy of anything. */}
            <div className="nu-compare-scroll">
            <Table<ComparedField>
              rowKey="name"
              size="small"
              className="nu-compare"
              columns={columns}
              dataSource={rows}
              pagination={false}
              rowClassName={(field) => (field.differs ? "nu-compare-differs" : "")}
              locale={{
                emptyText: (
                  <EmptyState
                    title="Nothing differs"
                    hint="Every field holds the same value. Switch to every field to see them."
                  />
                ),
              }}
              data-testid="compare-table"
            />
            </div>
          </Card>
        </>
      )}
    </>
  );
}
