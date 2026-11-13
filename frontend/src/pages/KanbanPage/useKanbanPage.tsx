import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { kanbanApi } from "@/api/kanban";
import { useBoardDrag } from "@/components/kanban/useBoardDrag";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { queryKeys } from "@/lib/queryKeys";
import { applyParamChanges } from "@/hooks/useUrlState";

import { withCardMoved } from "./withCardMoved";

/** The address keys that are places rather than adjustments (§history). */
const PLACES = new Set(["board", "card"]);

/**
 * The board page's state and writes: which board, its filters, the open card
 * (all in the address), the board query, the optimistic move and the drag
 * engine, and the lane and card mutations.
 */
export function useKanbanPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [creating, setCreating] = useState(false);
  /** The one-question modal for a new lane (§33). */
  const [namingLane, setNamingLane] = useState(false);
  const [term, setTerm] = useState(params.get("q") ?? "");

  const boardId = params.get("board") ?? "";
  const label = params.get("label") ?? "";
  const kind = params.get("kind") ?? "";
  const assignee = params.get("assignee") ?? "";
  const search = useDebouncedValue(term, 300);
  // The open card is in the address (replaced, not pushed), so a reload or a
  // trip to a record and back lands on the same card.
  const openCard = params.get("card");
  const setOpenCard = (id: string | null) => set({ card: id });

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => applyParamChanges(current, changes),
      // Where the reader *is* ("board", "card") is a place back returns to, so it
      // is pushed; everything else is an adjustment and replaces.
      { replace: !Object.entries(changes).some(([key, value]) => PLACES.has(key) && value) },
    );

  const boards = useQuery({
    queryKey: queryKeys.kanbanBoards(),
    queryFn: ({ signal }) => kanbanApi.boards({}, signal),
  });

  // The board the address names, or the first one this reader can open — so
  // arriving with no address lands on work rather than on a chooser.
  const chosen = boardId || boards.data?.items[0]?.id || "";

  const board = useQuery({
    queryKey: queryKeys.kanbanBoard(chosen, label, kind, assignee, search),
    queryFn: ({ signal }) =>
      kanbanApi.board(chosen, { label, kind, assignee_id: assignee, q: search }, signal),
    enabled: Boolean(chosen),
    // Keeps the columns on screen while a filter is applied: a board that
    // blanks on every keystroke is a board you cannot type into.
    placeholderData: (previous) => previous,
  });

  const detail = board.data;
  const canEdit = detail?.board.can_edit ?? false;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.kanbanBoard() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.kanbanBoards() });
  };

  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : "That could not be saved.");

  const move = useMutation({
    mutationFn: ({ id, laneId, position }: { id: string; laneId: string; position: number }) =>
      kanbanApi.moveCard(id, laneId, position),
    // Optimistic, then reconciled (§73). The card follows the pointer and the
    // server's answer is what stays — a refused move snaps back rather than
    // leaving the reader believing something that did not happen.
    onMutate: async ({ id, laneId, position }) => {
      const key = queryKeys.kanbanBoard(chosen, label, kind, assignee, search);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (current: typeof detail) =>
        current ? withCardMoved(current, id, laneId, position) : current,
      );
      return { key, previous };
    },
    onError: (error, _variables, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
      failed(error);
    },
    onSettled: invalidate,
  });

  /**
   * The board's drag, for every lane at once — a drag crosses columns, and
   * the lane a card came from has to know it is the source. Position is a
   * real instruction here, so the card lands where the gap was opened.
   */
  const laneList = detail?.lanes ?? [];
  const drag = useBoardDrag({
    enabled: canEdit,
    lanes: laneList.map((lane) => lane.id),
    items: (laneId) => laneList.find((lane) => lane.id === laneId)?.cards.map((card) => card.id) ?? [],
    onDrop: (id, _from, to) => move.mutate({ id, laneId: to.lane, position: to.index }),
    describe: (id) => {
      for (const lane of laneList) {
        const card = lane.cards.find((item) => item.id === id);
        if (card) return `${card.reference} ${card.title}`;
      }
      return "the card";
    },
    laneName: (laneId) => laneList.find((lane) => lane.id === laneId)?.name ?? "the lane",
  });

  const addLane = useMutation({
    mutationFn: (name: string) => kanbanApi.createLane(chosen, { name }),
    onSuccess: () => {
      message.success("Lane added");
      invalidate();
    },
    onError: failed,
  });

  const editLane = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Record<string, unknown> }) =>
      kanbanApi.updateLane(id, input),
    onSuccess: invalidate,
    onError: failed,
  });

  const dropLane = useMutation({
    mutationFn: ({ id, moveTo }: { id: string; moveTo?: string }) =>
      kanbanApi.removeLane(id, moveTo),
    onSuccess: (answer) => {
      message.success(
        answer.moved > 0
          ? `Lane removed — ${answer.moved} card${answer.moved === 1 ? "" : "s"} moved to ${answer.moved_to.name}`
          : "Lane removed",
      );
      invalidate();
    },
    onError: failed,
  });

  const addCard = useMutation({
    mutationFn: ({ laneId, title }: { laneId: string; title: string }) =>
      kanbanApi.createCard(chosen, { title, lane_id: laneId }),
    onSuccess: invalidate,
    onError: failed,
  });

  usePageCommands("kanban", [
    {
      id: "kanban.new-board",
      label: "Create a board",
      keywords: "new kanban workspace",
      run: () => setCreating(true),
    },
    {
      id: "kanban.mine",
      label: "Show only the cards assigned to me",
      keywords: "my work filter",
      run: () => set({ assignee: "me" }),
    },
    {
      id: "kanban.clear",
      label: "Clear the board filters",
      keywords: "reset all",
      run: () => {
        setTerm("");
        set({ label: null, kind: null, assignee: null, q: null });
      },
    },
  ]);

  return {
    params, setParams, queryClient, message, modal, creating, setCreating, namingLane, setNamingLane, term, setTerm, boardId, label, kind, assignee, search, openCard, setOpenCard, set, boards, chosen, board, detail, canEdit, invalidate, failed, move, drag, addLane, editLane, dropLane, addCard,
  };
}

export type KanbanPageModel = ReturnType<typeof useKanbanPage>;
