import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button, Skeleton } from "antd";
import dayjs from "dayjs";
import { useSearchParams } from "react-router-dom";

import { contractsApi, money } from "@/api/recordsAnalytics";
import { FailureAlert } from "@/components/FailureAlert";
import { EmptyState } from "@/components/EmptyState";
import { queryKeys } from "@/lib/queryKeys";

export function RenewalCalendar({ filters, onOpen }: { filters: Record<string, string | undefined>; onOpen: (id: string) => void }) {
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? dayjs().format("YYYY-MM");
  const calendar = useQuery({
    queryKey: queryKeys.contracts("calendar", month, filters),
    queryFn: ({ signal }) => contractsApi.calendar({ ...filters, month }, signal), 
    placeholderData: keepPreviousData,
  });
  const go = (delta: number) => {
    const next = new URLSearchParams(params);
    next.set("month", dayjs(`${month}-01`).add(delta, "month").format("YYYY-MM"));
    setParams(next, { replace: true });
  };
  const first = dayjs(`${month}-01`);
  const lead = (first.day() + 6) % 7;
  const days = first.daysInMonth();
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => i - lead + 1);
  const today = dayjs().format("YYYY-MM-DD");
  const events = calendar.data?.events ?? [];

  return (
    <section className="nx-ra-panel" data-testid="contract-calendar">
      <div className="nx-ra-panel-head">
        <h2>{first.format("MMMM YYYY")}</h2>
        <div style={{ display: "flex", gap: 6 }}>
          <Button onClick={() => go(-1)} aria-label="Previous month">‹</Button>
          <Button onClick={() => {
            const next = new URLSearchParams(params);
            next.delete("month");
            setParams(next, { replace: true });
          }}>Today</Button>
          <Button onClick={() => go(1)} aria-label="Next month">›</Button>
        </div>
      </div>
      {calendar.isError && <FailureAlert error={calendar.error} />}
      {calendar.isLoading ? (
        <Skeleton active />
      ) : (
        <div className="nx-ra-cal">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="nx-ra-cal-dow">{d}</div>)}
          {cells.map((n, index) => {
            const inMonth = n >= 1 && n <= days;
            const date = inMonth ? first.date(n).format("YYYY-MM-DD") : "";
            const here = inMonth ? events.filter((e) => e.day === date) : [];
            return (
              <div key={index} className={`nx-ra-cal-day${inMonth ? "" : " is-out"}${date === today ? " is-today" : ""}${here.length ? "" : " is-empty"}`}>
                <span>{inMonth ? (here.length ? first.date(n).format("ddd D") : n) : ""}</span>
                {here.map((event) => (
                  <button
                    key={`${event.kind}-${event.contract.id}`}
                    type="button"
                    className={`nx-ra-cal-ev${event.kind === "NOTICE" ? " is-notice" : ""}${event.contract.at_risk ? " is-risk" : ""}`}
                    onClick={() => onOpen(event.contract.id)}
                    title={`${event.kind === "NOTICE" ? "Notice deadline" : "Ends"} — ${event.contract.reference} ${event.contract.customer.name} (${money(event.contract.value)})`}
                  >
                    {event.kind === "NOTICE" ? "Notice · " : ""}
                    {event.contract.customer.name}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {!calendar.isLoading && events.length === 0 && <EmptyState compact title="No end dates or notice deadlines this month" />}
    </section>
  );
}
