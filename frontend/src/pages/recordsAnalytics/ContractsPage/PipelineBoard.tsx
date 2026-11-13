import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Skeleton } from "antd";
import { useMemo } from "react";

import {
  contractsApi,
  money,
  STAGE_LABEL,
  STAGE_ORDER,
  type ContractBoard,
  type ContractStage,
} from "@/api/recordsAnalytics";
import { Kpi } from "@/components/recordsAnalytics/parts";
import { DropGap, useBoardDrag } from "@/components/kanban/useBoardDrag";
import { FailureAlert } from "@/components/FailureAlert";
import { errorText } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

import { endsIn, riskFlag } from "./contractWords";

export function Summary({ board }: { board: Pick<ContractBoard, "summary"> }) {
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

export function PipelineBoard({
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
  const key = queryKeys.contracts("board", filters);
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
      void client.invalidateQueries({ queryKey: queryKeys.contracts() });
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
