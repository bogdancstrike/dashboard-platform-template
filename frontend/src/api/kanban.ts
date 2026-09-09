import { api } from "./client";

/**
 * Kanban boards (§18).
 *
 * Deliberately not the task client. `/tasks` is a view of the work queue whose
 * lanes are the declared status vocabulary; a board's columns are somebody's
 * own, and a card there is an epic, a story, a task or a bug. See
 * `services/kanban.py` for why that is a second model rather than a flag.
 */

/** What a card can be. The hierarchy rule lives on the server. */
export type CardKind = "EPIC" | "STORY" | "TASK" | "BUG";

export interface KanbanCard {
  id: string;
  board_id: string;
  lane_id: string | null;
  /** `PLAT-00042` — quotable without naming the board. */
  reference: string;
  kind: CardKind;
  title: string;
  description: string | null;
  parent_id: string | null;
  position: number;
  priority: string;
  story_points: number | null;
  assignee: { id: string | null; name: string | null; initials: string | null };
  labels: string[];
  due_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  checklist: { text: string; done: boolean }[];
  checklist_done: number;
  /** How many people have said something on it — counted with the board (§18). */
  comment_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface KanbanLane {
  id: string;
  name: string;
  position: number;
  /** `null` is no limit. Zero is refused — it would be a lane nothing enters. */
  wip_limit: number | null;
  is_done: boolean;
  /** The whole match, not the cards returned (§71). */
  total: number;
  /** A limit warns and never refuses; this is the warning. */
  over_limit: boolean;
  cards: KanbanCard[];
}

export interface KanbanBoard {
  id: string;
  key: string;
  name: string;
  description: string | null;
  scope: string;
  is_archived: boolean;
  owner: { id: string | null; is_me: boolean };
  lane_count: number;
  card_count?: number;
  can_edit: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface BoardDetail {
  board: KanbanBoard;
  lanes: KanbanLane[];
  /** Cards whose lane was removed while somebody was looking at the page. */
  unplaced: KanbanCard[];
  labels: string[];
  kinds: { key: CardKind; children: CardKind[] }[];
  priorities: string[];
  filters: { assignee_id: string; label: string; kind: string; q: string };
}

export interface BoardList {
  items: KanbanBoard[];
  total: number;
  can_create: boolean;
  kinds: { key: CardKind; children: CardKind[] }[];
  priorities: string[];
}

export interface CardDetail extends KanbanCard {
  board: KanbanBoard;
  lanes: { id: string; name: string; is_done: boolean }[];
  parent: KanbanCard | null;
  children: KanbanCard[];
  /**
   * What this card may be given as a parent.
   *
   * From the server's one hierarchy rule, so the picker cannot offer a
   * pairing the write would refuse (§76).
   */
  parent_options: KanbanCard[];
  can_edit: boolean;
}

export interface BoardFilters {
  assignee_id?: string;
  label?: string;
  kind?: string;
  q?: string;
  [key: string]: string | undefined;
}

export interface CardInput {
  title?: string;
  description?: string | null;
  kind?: CardKind;
  lane_id?: string;
  parent_id?: string | null;
  priority?: string;
  story_points?: number | null;
  assignee_id?: string | null;
  labels?: string[];
  due_date?: string | null;
  checklist?: { text: string; done: boolean }[];
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== false) search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : "";
}

export const kanbanApi = {
  boards: (params: { archived?: boolean } = {}, signal?: AbortSignal) =>
    api.get<BoardList>(`/api/kanban/boards${query(params)}`, { signal }),

  /** One board whole: a column at a time would be five requests per screen. */
  board: (id: string, filters: BoardFilters = {}, signal?: AbortSignal) =>
    api.get<BoardDetail>(`/api/kanban/boards/${id}${query(filters)}`, { signal }),

  createBoard: (input: { name: string; description?: string; scope?: string; key?: string }) =>
    api.post<KanbanBoard>("/api/kanban/boards", input),

  updateBoard: (id: string, input: Record<string, unknown>) =>
    api.put<KanbanBoard>(`/api/kanban/boards/${id}`, input),

  removeBoard: (id: string) =>
    api.delete<{ id: string; deleted: boolean }>(`/api/kanban/boards/${id}`),

  createLane: (boardId: string, input: { name: string; wip_limit?: number | null }) =>
    api.post<KanbanLane>(`/api/kanban/boards/${boardId}/lanes`, input),

  /** The whole column order at once — a drag produces one arrangement. */
  arrangeLanes: (boardId: string, laneIds: string[]) =>
    api.put<{ lanes: KanbanLane[] }>(`/api/kanban/boards/${boardId}/lanes`, {
      lane_ids: laneIds,
    }),

  updateLane: (laneId: string, input: Record<string, unknown>) =>
    api.put<KanbanLane>(`/api/kanban/lanes/${laneId}`, input),

  /**
   * Remove a lane, saying where its cards go.
   *
   * The destination is part of the request because a lane holding work cannot
   * be removed without deciding it — and deciding it in the service would be
   * the service choosing on somebody's behalf. A query parameter rather than a
   * body: a `DELETE` with a body is carried unevenly by proxies and clients.
   */
  removeLane: (laneId: string, moveTo?: string) =>
    api.delete<{
      id: string;
      deleted: boolean;
      moved: number;
      moved_to: { id: string; name: string };
    }>(`/api/kanban/lanes/${laneId}${query({ move_to: moveTo })}`),

  createCard: (boardId: string, input: CardInput) =>
    api.post<KanbanCard>(`/api/kanban/boards/${boardId}/cards`, input),

  card: (id: string, signal?: AbortSignal) =>
    api.get<CardDetail>(`/api/kanban/cards/${id}`, { signal }),

  updateCard: (id: string, input: CardInput) =>
    api.put<KanbanCard>(`/api/kanban/cards/${id}`, input),

  removeCard: (id: string) =>
    api.delete<{ id: string; deleted: boolean; reparented: number }>(
      `/api/kanban/cards/${id}`,
    ),

  /**
   * Put a card in a lane at a position.
   *
   * Its own endpoint rather than a field on the card: a drop renumbers the
   * card's neighbours and decides whether the card is finished, and a generic
   * update doing that as a side effect of setting `lane_id` would be a write
   * whose consequences are invisible at the call site.
   */
  moveCard: (id: string, laneId: string, position: number) =>
    api.post<KanbanCard>(`/api/kanban/cards/${id}/move`, {
      lane_id: laneId,
      position,
    }),
};
