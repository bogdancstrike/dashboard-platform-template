import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { kanbanApi, type CardInput } from "@/api/kanban";
import { queryKeys } from "@/lib/queryKeys";

/** The card behind the drawer, and every write the drawer makes to it. */
export function useCardDrawer(cardId: string | null, onChanged: () => void, onClose: () => void) {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [step, setStep] = useState("");

  const card = useQuery({
    queryKey: queryKeys.kanbanCard(cardId),
    queryFn: ({ signal }) => kanbanApi.card(cardId!, signal),
    enabled: Boolean(cardId),
  });

  const detail = card.data;
  const canEdit = detail?.can_edit ?? false;

  const write = useMutation({
    mutationFn: (input: CardInput) => kanbanApi.updateCard(cardId!, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.kanbanCard(cardId), (current: typeof detail) =>
        current ? { ...current, ...updated } : current,
      );
      onChanged();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That change was refused."),
  });

  const relocate = useMutation({
    mutationFn: (laneId: string) => kanbanApi.moveCard(cardId!, laneId, 0),
    onSuccess: () => {
      void card.refetch();
      onChanged();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That move was refused."),
  });

  const remove = useMutation({
    mutationFn: () => kanbanApi.removeCard(cardId!),
    onSuccess: (answer) => {
      message.success(
        answer.reparented > 0
          ? `Deleted — ${answer.reparented} card${answer.reparented === 1 ? "" : "s"} moved up a level`
          : "Card deleted",
      );
      onChanged();
      onClose();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That could not be deleted."),
  });

  /** Tick a to-do. It is a field on the card, audited with every other edit. */
  const tick = (index: number, done: boolean) => {
    if (!detail) return;
    write.mutate({
      checklist: detail.checklist.map((item, position) =>
        position === index ? { ...item, done } : item,
      ),
    });
  };

  const addStep = () => {
    const text = step.trim();
    if (!text || !detail) return;
    write.mutate({ checklist: [...detail.checklist, { text, done: false }] });
    setStep("");
  };

  return { card, detail, canEdit, write, relocate, remove, tick, step, setStep, addStep };
}

export type CardDrawerModel = ReturnType<typeof useCardDrawer>;
