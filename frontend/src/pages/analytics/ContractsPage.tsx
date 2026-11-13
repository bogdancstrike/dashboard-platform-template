/**
 * Contracts and the renewals pipeline (§13).
 *
 * Four views of one set of contracts, the view in the address (`?view=`):
 * the **board** — a column per stage, dragged between (`useBoardDrag`, so
 * pointer, touch and keyboard all work); the **list**; the **forecast** —
 * renewal ARR per quarter, weighted by probability; and the **calendar** of
 * end dates and notice deadlines. Contracts whose customer's health is at
 * risk or critical carry the flag everywhere.
 */
import "@/styles/analytics.css";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Input, Segmented, Skeleton, Table, Tooltip } from "antd";
import dayjs from "dayjs";
import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useUrlOverlay } from "@/app/useUrlOverlay";
import { usePageCommands } from "@/commands/CommandContext";
import {
  contractsApi,
  money,
  STAGE_LABEL,
  STAGE_ORDER,
  type ContractBoard,
  type ContractCard,
  type ContractStage,
} from "@/api/recordsAnalytics";
import { ContractForm } from "@/components/analytics/ContractForm";
import { BandPill, Kpi } from "@/components/analytics/parts";
import { DropGap, useBoardDrag } from "@/components/kanban/useBoardDrag";
import { FailureAlert } from "@/components/FailureAlert";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { StatusTag } from "@/components/StatusTag";
import { useAuth } from "@/auth/AuthProvider";
import { errorText } from "@/lib/errors";

type View = "board" | "list" | "forecast" | "calendar";
const VIEWS: { value: View; label: string }[] = [
  { value: "board", label: "Pipeline" },
  { value: "list", label: "List" },
  { value: "forecast", label: "Forecast" },
  { value: "calendar", label: "Calendar" },
];

export function riskFlag(card: Pick<ContractCard, "at_risk" | "health_band">) {
  return card.at_risk ? (
    <Tooltip title={`Customer health: ${card.health_band === "CRITICAL" ? "critical" : "at risk"}`}>
      <span className="nx-ra-risk" data-testid="at-risk">At risk</span>
    </Tooltip>
  ) : null;
}

function endsIn(days: number | null): string {
  if (days === null) return "";
  if (days < 0) return `ended ${-days}d ago`;
  if (days === 0) return "ends today";
  return days > 60 ? `ends ${dayjs().add(days, "day").format("D MMM")}` : `ends in ${days}d`;
}

export default function ContractsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((v) => v.value === params.get("view"))?.value ?? "board") as View;
  const q = params.get("q") ?? "";
  const atRisk = params.get("at_risk") === "1";
  const creating = useUrlOverlay("contract");
  const { can } = useAuth();
  const canManage = can("contracts.manage");

  const set = (key: string, value: string | null, push = false) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: !push });
  };

  const filters = { q: q || undefined, at_risk: atRisk ? "true" : undefined };

  usePageCommands("contracts", [
    { id: "contracts.new", label: "New contract", keywords: "renewal create", run: () => creating.open("new") },
    { id: "contracts.forecast", label: "Show the renewal forecast", keywords: "quarter arr", run: () => set("view", "forecast", true) },
  ]);

  return (
    <div data-testid="contracts-page">
      <PageHeader
        title={<>Contracts & <em>renewals</em></>}
        subtitle="Every customer agreement worked as a renewal — value, stage, probability and the customer's health beside it."
        actions={
          canManage && (
            <Button type="primary" icon={<NxIcon name="plus" />} onClick={() => creating.open("new")} data-testid="contract-new">
              New contract
            </Button>
          )
        }
      />
      <div className="nx-ra-chips">
        <Segmented
          value={view}
          onChange={(value) => set("view", value === "board" ? null : String(value), true)}
          options={VIEWS}
          aria-label="Contract views"
        />
        <Input.Search
          allowClear
          defaultValue={q}
          placeholder="Contract, reference or customer"
          onSearch={(value) => set("q", value || null)}
          style={{ maxWidth: 280 }}
          aria-label="Search contracts"
        />
        <button type="button" className="nx-ra-chip" aria-pressed={atRisk} onClick={() => set("at_risk", atRisk ? null : "1")}>
          At risk only
        </button>
      </div>

      {view === "board" && <PipelineBoard filters={filters} canManage={canManage} onOpen={(id) => navigate(`/contracts/${id}`)} />}
      {view === "list" && <ContractTable filters={filters} onOpen={(id) => navigate(`/contracts/${id}`)} />}
      {view === "forecast" && <Forecast />}
      {view === "calendar" && <RenewalCalendar filters={filters} onOpen={(id) => navigate(`/contracts/${id}`)} />}

      <ContractForm open={creating.value === "new"} onClose={creating.close} onSaved={(saved) => navigate(`/contracts/${saved.id}`, { replace: true })} />
    </div>
  );
}

function Summary({ board }: { board: Pick<ContractBoard, "summary"> }) {
  const s = board.summary;
  return (
    <div className="nx-ra-kpis">
      <Kpi label="Open pipeline" value={money(s.pipeline)} hint={`${s.open} contracts`} testId="contracts-pipeline" />
      <Kpi label="Weighted" value={money(s.weighted)} hint="value × probability" />
      <Kpi label="Up within 90 days" value={s.due_90} hint="open renewals" tone={s.due_90 ? "warn" : undefined} />
      <Kpi label="At risk" value={money(s.at_risk_value)} hint={`${s.at_risk} with an unhealthy customer`} tone={s.at_risk ? "bad" : undefined} />
    </div>
  );
}

function PipelineBoard({
  filters,
  canManage,
  onOpen,
}: {
  filters: Record<string, string | undefined>;
  canManage: boolean;
  onOpen: (id: string) => void;
}) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const key = ["contracts", "board", filters];
  const board = useQuery({ queryKey: key, queryFn: ({ signal }) => contractsApi.board(filters, signal), placeholderData: keepPreviousData });
  const columns = board.data?.columns ?? [];
  const byId = useMemo(() => new Map(columns.flatMap((c) => c.cards.map((card) => [card.id, card] as const))), [columns]);

  const move = useMutation({
    mutationFn: (input: { id: string; stage: ContractStage; before_id: string | null }) =>
      contractsApi.move(input.id, { stage: input.stage, before_id: input.before_id }),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ContractBoard>(key);
      if (previous) {
        const card = previous.columns.flatMap((c) => c.cards).find((c) => c.id === input.id);
        if (card) {
          const moved = { ...card, stage: input.stage, stage_label: STAGE_LABEL[input.stage] };
          const next = previous.columns.map((column) => {
            const cards = column.cards.filter((c) => c.id !== input.id);
            if (column.stage !== input.stage) return { ...column, cards };
            const at = input.before_id ? cards.findIndex((c) => c.id === input.before_id) : -1;
            cards.splice(at < 0 ? cards.length : at, 0, moved);
            return { ...column, cards };
          });
          client.setQueryData<ContractBoard>(key, { ...previous, columns: next });
        }
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
      void message.error(errorText(error, { action: "move contracts" }));
    },
    onSuccess: (saved) => void message.success(`${saved.reference} → ${STAGE_LABEL[saved.stage]} (${saved.probability}%)`),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["contracts"] });
    },
  });

  const drag = useBoardDrag({
    enabled: canManage,
    lanes: STAGE_ORDER,
    items: (lane) => columns.find((c) => c.stage === lane)?.cards.map((c) => c.id) ?? [],
    onDrop: (id, _from, to) => {
      const lane = columns.find((c) => c.stage === to.lane);
      const others = (lane?.cards ?? []).filter((c) => c.id !== id);
      move.mutate({ id, stage: to.lane as ContractStage, before_id: others[to.index]?.id ?? null });
    },
    describe: (id) => {
      const card = byId.get(id);
      return card ? `${card.reference} ${card.title}` : id;
    },
    laneName: (lane) => STAGE_LABEL[lane as ContractStage],
  });

  if (board.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (board.isError) return <FailureAlert error={board.error} onRetry={() => void board.refetch()} />;

  return (
    <>
      <Summary board={board.data!} />
      <div className="nx-ra-board" data-testid="contract-board">
        {columns.map((column) => (
          <section
            key={column.stage}
            className={`nx-ra-lane ${drag.laneProps(column.stage).className}`}
            data-drop-lane={column.stage}
            data-stage={column.stage}
            aria-label={`${column.label}: ${column.count} contracts`}
          >
            <header>
              <i aria-hidden />
              <b>{column.label}</b>
              <span className="nx-ra-count">{column.cards.length}</span>
            </header>
            <div className="nx-ra-lane-sum">
              <span>
                <b>{money(column.value)}</b> ARR
              </span>
              <span>{column.stage === "RENEWED" || column.stage === "CHURNED" ? "last 120 days" : `${column.probability}% default`}</span>
            </div>
            <ol data-drop-list={column.stage}>
              {drag.renderLane(
                column.stage,
                column.cards,
                (card) => card.id,
                (card) => {
                  const props = drag.cardProps(card.id, column.stage);
                  return (
                    <li key={card.id}>
                      <article
                        {...props}
                        className={`nx-ra-card ${props.className}`}
                        data-testid={`contract-card-${card.reference}`}
                        onClick={() => !drag.isDragging && onOpen(card.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !drag.isDragging) onOpen(card.id);
                          else props.onKeyDown(event);
                        }}
                        aria-label={`${card.reference} ${card.title}`}
                      >
                        <div className="nx-ra-card-top">
                          <span>{card.reference}</span>
                          <span>{endsIn(card.days_to_end)}</span>
                        </div>
                        <h4>{card.customer.name}</h4>
                        <div className="nx-ra-card-meta">
                          <span className="nx-ra-card-value">{money(card.value, card.currency)}</span>
                          <span className="nx-ra-muted">{card.probability}%</span>
                          {riskFlag(card)}
                        </div>
                      </article>
                    </li>
                  );
                },
                (height) => <DropGap key="gap" height={height} />,
              )}
            </ol>
            {column.cards.length === 0 && !drag.isDragging && <p className="nx-ra-muted" style={{ padding: 8 }}>Nothing here.</p>}
          </section>
        ))}
      </div>
      {drag.overlay}
      {canManage && <p className="nx-ra-keys">Drag a card to another stage — or focus it and press <kbd>Space</kbd>, the arrows, then <kbd>Space</kbd>.</p>}
    </>
  );
}

function ContractTable({ filters, onOpen }: { filters: Record<string, string | undefined>; onOpen: (id: string) => void }) {
  const list = useQuery({
    queryKey: ["contracts", "list", filters],
    queryFn: ({ signal }) => contractsApi.list({ ...filters, page_size: 200 }, signal), 
    placeholderData: keepPreviousData,
  });
  if (list.isError) return <FailureAlert error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <>
      {list.data && <Summary board={list.data} />}
      <div className="nx-ra-panel">
        <Table<ContractCard>
          rowKey="id"
          size="middle"
          loading={list.isLoading}
          dataSource={list.data?.items ?? []}
          scroll={{ x: 820 }}
          pagination={{ pageSize: 25, showSizeChanger: false }}
          onRow={(row) => ({ onClick: () => onOpen(row.id), style: { cursor: "pointer" } })}
          columns={[
            { title: "Contract", dataIndex: "reference", render: (_: unknown, row) => (<><b>{row.reference}</b><div className="nx-ra-muted">{row.title}</div></>) },
            { title: "Customer", render: (_: unknown, row) => (<>{row.customer.name} {riskFlag(row)}</>) },
            { title: "Stage", dataIndex: "stage", render: (stage: ContractStage) => <StatusTag status={stage} label={STAGE_LABEL[stage]} /> },
            { title: "Value", dataIndex: "value", align: "right", sorter: (a, b) => a.value - b.value, render: (v: number, row) => money(v, row.currency) },
            { title: "Prob.", dataIndex: "probability", align: "right", render: (v: number) => `${v}%` },
            { title: "Ends", dataIndex: "end_date", sorter: (a, b) => String(a.end_date).localeCompare(String(b.end_date)), render: (v: string, row) => (<>{v}<div className="nx-ra-muted">{endsIn(row.days_to_end)}</div></>) },
            { title: "Health", render: (_: unknown, row) => <BandPill band={row.health_band} score={row.health_score} /> },
            { title: "Owner", render: (_: unknown, row) => row.owner.name ?? "—" },
          ]}
        />
      </div>
    </>
  );
}

function Forecast() {
  const forecast = useQuery({ queryKey: ["contracts", "forecast"], queryFn: ({ signal }) => contractsApi.forecast({ quarters: 4 }, signal) });
  if (forecast.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (forecast.isError) return <FailureAlert error={forecast.error} onRetry={() => void forecast.refetch()} />;
  const data = forecast.data!;
  const max = Math.max(1, ...data.quarters.map((q) => q.pipeline + q.renewed + q.churned));
  return (
    <div className="nx-ra-stack" data-testid="contract-forecast">
      <div className="nx-ra-kpis">
        <Kpi label="Up for renewal" value={money(data.totals.pipeline)} hint="open, next four quarters" />
        <Kpi label="Weighted forecast" value={money(data.totals.weighted)} hint="incl. renewed" />
        <Kpi label="Renewed" value={money(data.totals.renewed)} tone="ok" />
        <Kpi label="Churned" value={money(data.totals.churned)} tone={data.totals.churned ? "bad" : undefined} />
      </div>
      <section className="nx-ra-panel nx-ra-forecast">
        <div className="nx-ra-panel-head">
          <h2>Renewal ARR by quarter</h2>
          <span className="nx-ra-sub">By the quarter the contract ends</span>
        </div>
        <div className="nx-ra-scroll">
          <table>
            <thead>
              <tr>
                <th>Quarter</th><th>Contracts</th><th>Open</th><th>Committed</th><th>Weighted</th><th>Renewed</th><th>Churned</th><th>At risk</th>
                <th style={{ minWidth: 140 }} aria-label="Shape" />
              </tr>
            </thead>
            <tbody>
              {data.quarters.map((quarter) => (
                <tr key={quarter.key} className={quarter.current ? "is-current" : ""}>
                  <td>{quarter.label}{quarter.current ? " · now" : ""}</td>
                  <td>{quarter.count}</td>
                  <td>{money(quarter.pipeline)}</td>
                  <td>{money(quarter.committed)}</td>
                  <td><b>{money(quarter.weighted)}</b></td>
                  <td>{money(quarter.renewed)}</td>
                  <td>{money(quarter.churned)}</td>
                  <td>{quarter.at_risk ? money(quarter.at_risk) : "—"}</td>
                  <td>
                    <div className="nx-ra-dist" style={{ margin: 0, height: 10 }} aria-hidden>
                      {quarter.renewed > 0 && <i className="HEALTHY" style={{ width: `${(quarter.renewed / max) * 100}%` }} />}
                      {quarter.pipeline > 0 && <i style={{ width: `${(quarter.pipeline / max) * 100}%`, background: "var(--nu-accent)" }} />}
                      {quarter.churned > 0 && <i className="CRITICAL" style={{ width: `${(quarter.churned / max) * 100}%` }} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RenewalCalendar({ filters, onOpen }: { filters: Record<string, string | undefined>; onOpen: (id: string) => void }) {
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? dayjs().format("YYYY-MM");
  const calendar = useQuery({
    queryKey: ["contracts", "calendar", month, filters],
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
          <Button size="small" onClick={() => go(-1)} aria-label="Previous month">‹</Button>
          <Button size="small" onClick={() => {
            const next = new URLSearchParams(params);
            next.delete("month");
            setParams(next, { replace: true });
          }}>Today</Button>
          <Button size="small" onClick={() => go(1)} aria-label="Next month">›</Button>
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
      {!calendar.isLoading && events.length === 0 && <Empty description="No end dates or notice deadlines this month" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
    </section>
  );
}
