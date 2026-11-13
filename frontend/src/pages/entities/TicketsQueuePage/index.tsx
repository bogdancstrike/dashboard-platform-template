/**
 * Tickets as a table (§7, §62, §63).
 *
 * This page was a split view: the queue on the left, a *preview* of the chosen
 * ticket on the right, and "Full record" from there to the console. Two things
 * were wrong with it. The preview was a second rendering of a record that
 * already has a page — the same description, the same tags, the same history,
 * maintained twice and slightly differently — and the queue itself was a list
 * of coloured chips in a 380-pixel column, which is the one shape that cannot
 * answer "which of these forty is worst".
 *
 * So the queue is a table and the console is the console. A row is a line a
 * reader scans down: severity in one column, the clock in another, and the
 * subject wide enough to read. Clicking it opens `/tickets/:id`, which is
 * where the work is done.
 *
 * **The SLA column is the point of the page**, and it is derived rather than
 * printed: `entities/sla.ts` turns four timestamps into "Breached 3d ago" or
 * "Due in 5h", which is the fact somebody triages on. Whether the promise was
 * *missed* is still the server's answer (`sla_breached`) — a page that decided
 * that for itself would disagree with every report ever run (§71).
 */

import { Segmented, Skeleton } from "antd";

import { NewRecordButton } from "@/components/records/useRecordEditing";
import { usePageCommands } from "@/commands/CommandContext";
import {
  EntityEmpty,
  EntityError,
  EntityFilters,
  EntityHeader,
  MetricStrip,
} from "@/entities/EntityChrome";
import { EntityTable, useEntityBulk, useEntityList } from "@/entities/list";

import { ticketColumns } from "./columns";
import { COLUMNS, type TicketRow } from "./types";

export default function TicketsQueuePage() {
  const list = useEntityList<TicketRow>("ticket", "/tickets", {
    columns: COLUMNS,
    defaultSort: "severity",
    defaultOrder: "asc",
  });
  const { view, records } = list;
  const bulk = useEntityBulk(view);

  usePageCommands("entity:ticket", [
    {
      id: "ticket.new",
      label: "Raise a ticket",
      keywords: "new add create report",
      run: records.create,
    },
    {
      id: "ticket.breached",
      label: "Show tickets that have breached their SLA",
      keywords: "sla late overdue",
      run: () => view.setFilter("sla_breached", "true"),
    },
    {
      id: "ticket.critical",
      label: "Show critical tickets",
      keywords: "severity urgent",
      run: () => view.setFilter("severity", "CRITICAL"),
    },
  ]);

  if (view.catalogue.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <EntityHeader
        view={view}
        subtitle="The queue, worst first — severity, the clock, and what it is about, on one line each."
        actions={<NewRecordButton records={records} resource={view.resource} />}
      />

      <MetricStrip view={view} accents={["accent", "info", "danger", "neutral"]} />

      <EntityFilters view={view} only={["severity", "status", "category", "channel", "priority"]}>
        {/* The one filter worth a control of its own: it is the reason the
            page is open, and burying it in a select makes it a search. */}
        <Segmented
          aria-label="SLA"
          data-testid="sla-filter"
          value={view.filters["sla_breached"] ?? "all"}
          onChange={(next) =>
            view.setFilter("sla_breached", next === "all" ? null : String(next))
          }
          options={[
            { label: "Any SLA", value: "all" },
            { label: "Breached", value: "true" },
            { label: "Within SLA", value: "false" },
          ]}
        />
      </EntityFilters>

      <EntityError view={view} />

      <EntityTable<TicketRow>
        list={list}
        bulk={bulk}
        testIdOn="card"
        data-testid="ticket-queue"
        columns={ticketColumns(records)}
        scroll={{ x: 940 }}
        empty={
          <EntityEmpty
            view={view}
            title="Nothing has been raised"
            hint="A ticket is a customer's problem with a deadline attached."
            action={<NewRecordButton records={records} resource={view.resource} />}
          />
        }
      />

      {records.drawer}
      {bulk.dialog}
    </>
  );
}
