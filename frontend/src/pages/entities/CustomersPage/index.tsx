/**
 * Customers as accounts (§7).
 *
 * An account is read as a *whole* — who they are, what they are worth, how
 * they feel, when anybody last spoke to them — and those four facts read
 * badly as four columns and well as one card. So this is a card grid, and the
 * cards are sorted by lifetime value because that is the order somebody asks
 * for when they say "show me the customers".
 *
 * Beside the grid sits the shape of the book: value by segment, and the
 * lifecycle funnel. Both are the server's aggregates over the *filtered* set,
 * so narrowing to one country redraws them rather than leaving them describing
 * a different question from the one on screen.
 */

import { Skeleton } from "antd";

import { NewRecordButton } from "@/components/records/useRecordEditing";
import { usePageCommands } from "@/commands/CommandContext";
import {
  EntityEmpty,
  EntityError,
  EntityFilters,
  EntityHeader,
  MetricStrip,
} from "@/entities/EntityChrome";
import { EntityPager, useEntityList } from "@/entities/list";

import { AccountCard } from "./AccountCard";
import { BookAside } from "./BookAside";
import { COLUMNS, type CustomerRow } from "./types";

export default function CustomersPage() {
  const { view, rows, records, navigate } = useEntityList<CustomerRow>("customer", "/customers", {
    columns: COLUMNS,
    defaultSort: "lifetime_value",
    defaultPageSize: 24,
  });
  const insights = view.insights.data;

  const breakdown = (field: string) =>
    insights?.breakdowns.find((item) => item.field === field);

  usePageCommands("entity:customer", [
    {
      id: "customer.new",
      label: "Create an account",
      keywords: "new add create customer",
      run: records.create,
    },
    {
      id: "customer.at-risk",
      label: "Show accounts with low satisfaction",
      keywords: "unhappy churn risk",
      run: () => navigate("/explore?resource=customer&sort=satisfaction&order=asc"),
    },
    {
      id: "customer.enterprise",
      label: "Show enterprise accounts",
      keywords: "segment tier",
      run: () => view.setFilter("segment", "ENTERPRISE"),
    },
  ]);

  if (view.catalogue.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <EntityHeader
        view={view}
        subtitle="The book of business, richest first — with what each account is worth and how it feels."
        actions={<NewRecordButton records={records} resource={view.resource} />}
      />

      <MetricStrip view={view} accents={["accent", "success", "info", "warning"]} />
      <EntityFilters view={view} only={["segment", "lifecycle_stage", "industry", "country", "health_band"]} />
      <EntityError view={view} />

      <div className="nx-rec-book">
      <div className="nx-rec-book-main">
      {view.rows.isLoading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : rows.length === 0 ? (
        <EntityEmpty
          view={view}
          card
          title="No accounts yet"
          hint="An account is a customer with a value and a lifecycle."
          action={<NewRecordButton records={records} resource={view.resource} />}
        />
      ) : (
        <div className="nu-account-grid" data-testid="customer-grid">
          {rows.map((customer) => (
            <AccountCard key={customer.id} customer={customer} records={records} />
          ))}
        </div>
      )}
      </div>
      <BookAside
        segments={breakdown("segment")?.series ?? []}
        stages={breakdown("lifecycle_stage")?.series ?? []}
        active={{ segment: view.filters["segment"], stage: view.filters["lifecycle_stage"] }}
        onSegment={(name) => view.setFilter("segment", name)}
        onStage={(name) => view.setFilter("lifecycle_stage", name)}
      />
      </div>
      <EntityPager view={view} defaultPageSize={24} pageSizeOptions={[12, 24, 48, 96]} />

      {records.drawer}
    </>
  );
}
