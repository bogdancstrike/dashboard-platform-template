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
import { Alert, Button, Card, Segmented, Skeleton, Space, Table, Typography } from "antd";
import { Link, useSearchParams } from "react-router-dom";
import { useSmartBack } from "@/app/history";

import type { ComparedField } from "@/api/compare";
import { compareApi } from "@/api/compare";
import { ApiError } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { formatNumber } from "@/lib/formats";
import { queryKeys } from "@/lib/queryKeys";

import { idsFrom, summarise } from "./compare";

import { compareColumns } from "./columns";

export { idsFrom, summarise } from "./compare";

const { Text } = Typography;

export default function ComparePage() {
  const back = useSmartBack();
  const [params] = useSearchParams();
  const resourceType = params.get("type") ?? "";
  const ids = useMemo(() => idsFrom(params.get("ids")), [params]);
  const [show, setShow] = useState<"differences" | "everything">("differences");

  const query = useQuery({
    queryKey: queryKeys.compare(resourceType, ids),
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
      run: () => back(`/explore?resource=${resourceType}`),
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

  const columns = useMemo(() => compareColumns(comparison), [comparison]);

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
            <Button onClick={() => back(comparison.path)} data-testid="compare-back">
              Back to the list
            </Button>
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
              className="nu-compare nx-rec-table"
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
