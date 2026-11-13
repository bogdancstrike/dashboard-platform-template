import { type KanbanCard, type KanbanLane } from "@/api/kanban";

/**
 * The board as it will be once a move lands, for the optimistic update.
 *
 * A pure function over the query's data so the guess and the server's answer
 * have the same shape — and so the arithmetic can be tested without a board
 * on screen. It renumbers exactly as the service does: dense, within the two
 * lanes involved, because a guess that left a gap would be corrected by the
 * refetch and *look* like a bug in the drag.
 */
export function withCardMoved<
  T extends { lanes: KanbanLane[] },
>(detail: T, cardId: string, laneId: string, position: number): T {
  let moving: KanbanCard | undefined;
  const without = detail.lanes.map((lane) => {
    const found = lane.cards.find((card) => card.id === cardId);
    if (found) moving = found;
    return {
      ...lane,
      cards: lane.cards.filter((card) => card.id !== cardId),
    };
  });
  if (!moving) return detail;

  const card = moving;
  return {
    ...detail,
    lanes: without.map((lane) => {
      if (lane.id !== laneId) {
        return { ...lane, cards: lane.cards.map((item, index) => ({ ...item, position: index })) };
      }
      const cards = [...lane.cards];
      cards.splice(Math.min(position, cards.length), 0, { ...card, lane_id: laneId });
      return {
        ...lane,
        // The counts follow too, or a drag makes the header disagree with the
        // column under it until the refetch lands.
        total: lane.total + (card.lane_id === laneId ? 0 : 1),
        cards: cards.map((item, index) => ({ ...item, position: index })),
      };
    }),
  };
}
