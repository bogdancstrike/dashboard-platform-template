/**
 * `/kanban` — boards whose columns are somebody's own (§18).
 *
 * The gallery and the board are one route, because a board *is* the page: a
 * separate `/kanban` list that you leave to open `/kanban/:id` would put a
 * click between somebody and the only thing they came for, every morning. So
 * the address carries the board (§69) and the gallery is what you see when it
 * carries none.
 *
 * Four decisions worth stating.
 *
 * **The whole board arrives in one request.** Five columns fetched separately
 * is five requests to draw one screen, and five loading states that finish in
 * a different order every time.
 *
 * **A drop is optimistic and then reconciled** (§73). The card moves under the
 * pointer, the request goes, and the server's answer replaces the guess — so a
 * refused move snaps back rather than leaving the reader believing something
 * that did not happen.
 *
 * **A lane count is the server's, over the whole match.** "In progress (12)"
 * means twelve of the cards the current filter matches, which is not the same
 * number as the cards drawn — a lane shows the first hundred.
 *
 * **A WIP limit is shown and never enforced.** The board says a lane is over
 * its limit; it does not refuse the drop. A board that argues gets worked
 * around in a spreadsheet, and then nobody can see the work at all.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Dropdown,
  Input,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { kanbanApi, type KanbanCard, type KanbanLane } from "@/api/kanban";
import { BoardGallery } from "@/components/kanban/BoardGallery";
import { CardDrawer } from "@/components/kanban/CardDrawer";
import { LaneColumn } from "@/components/kanban/LaneColumn";
import { NewBoardModal } from "@/components/kanban/NewBoardModal";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PeoplePicker } from "@/components/PeoplePicker";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

export default function KanbanPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [creating, setCreating] = useState(false);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [term, setTerm] = useState(params.get("q") ?? "");

  const boardId = params.get("board") ?? "";
  const label = params.get("label") ?? "";
  const kind = params.get("kind") ?? "";
  const assignee = params.get("assignee") ?? "";
  const search = useDebouncedValue(term, 300);

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const boards = useQuery({
    queryKey: ["kanban-boards"],
    queryFn: ({ signal }) => kanbanApi.boards({}, signal),
  });

  // The board the address names, or the first one this reader can open — so
  // arriving with no address lands on work rather than on a chooser.
  const chosen = boardId || boards.data?.items[0]?.id || "";

  const board = useQuery({
    queryKey: ["kanban-board", chosen, label, kind, assignee, search],
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
    void queryClient.invalidateQueries({ queryKey: ["kanban-board"] });
    void queryClient.invalidateQueries({ queryKey: ["kanban-boards"] });
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
      const key = ["kanban-board", chosen, label, kind, assignee, search];
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

  if (boards.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (boards.isError) {
    return (
      <>
        <PageHeader title="Kanban boards" />
        <Alert
          type={boards.error instanceof ApiError && boards.error.isForbidden ? "warning" : "error"}
          showIcon
          message={
            boards.error instanceof ApiError
              ? boards.error.message
              : "Boards could not be loaded."
          }
          action={
            <Button size="small" onClick={() => void boards.refetch()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  const canCreate = boards.data?.can_create ?? false;
  const filtered = Boolean(label || kind || assignee || search);

  return (
    <>
      <PageHeader
        title={detail?.board.name ?? "Kanban boards"}
        subtitle={
          detail
            ? (detail.board.description ??
              "Columns you name, cards you drag — and a limit that warns rather than argues.")
            : "A workspace whose columns are your own, unlike the task board's."
        }
        tag={detail ? <Tag color="blue">{detail.board.key}</Tag> : undefined}
        actions={
          <Space size={8}>
            {/* The board picker, not a route: a board *is* the page. */}
            {(boards.data?.items.length ?? 0) > 1 && (
              <Select
                aria-label="Board"
                data-testid="board-picker"
                style={{ minWidth: 200 }}
                value={chosen || undefined}
                onChange={(next) => set({ board: next })}
                options={(boards.data?.items ?? []).map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${item.card_count ?? 0}`,
                }))}
              />
            )}
            {canEdit && detail && (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    { key: "lane", icon: <PlusOutlined />, label: "Add a lane" },
                    {
                      key: "archive",
                      icon: <EditOutlined />,
                      label: detail.board.is_archived ? "Unarchive board" : "Archive board",
                    },
                    {
                      key: "delete",
                      icon: <DeleteOutlined />,
                      danger: true,
                      label: "Delete board",
                    },
                  ],
                  onClick: ({ key }) => {
                    if (key === "lane") promptForLane();
                    else if (key === "archive") {
                      void kanbanApi
                        .updateBoard(detail.board.id, {
                          is_archived: !detail.board.is_archived,
                        })
                        .then(invalidate)
                        .catch(failed);
                    } else {
                      modal.confirm({
                        title: `Delete ${detail.board.name}?`,
                        content:
                          "Every lane and card on it goes. The audit trail keeps what happened.",
                        okText: "Delete",
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          await kanbanApi.removeBoard(detail.board.id);
                          set({ board: null });
                          invalidate();
                        },
                      });
                    }
                  },
                }}
              >
                <Button icon={<SettingOutlined />} data-testid="board-actions">
                  Board
                </Button>
              </Dropdown>
            )}
            <Tooltip title={canCreate ? "" : "Your role does not include dashboards.manage"}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canCreate}
                onClick={() => setCreating(true)}
                data-testid="new-board"
              >
                New board
              </Button>
            </Tooltip>
          </Space>
        }
      />

      {!chosen ? (
        <BoardGallery
          boards={boards.data?.items ?? []}
          canCreate={canCreate}
          onOpen={(id) => set({ board: id })}
          onCreate={() => setCreating(true)}
        />
      ) : (
        <>
          <Card size="small" className="nu-filter-bar nu-block">
            <Space size={8} wrap>
              <Input.Search
                allowClear
                placeholder="Search this board"
                aria-label="Search this board"
                style={{ width: 220 }}
                value={term}
                onChange={(event) => {
                  setTerm(event.target.value);
                  set({ q: event.target.value || null });
                }}
              />
              <Select
                aria-label="Kind"
                style={{ minWidth: 130 }}
                allowClear
                placeholder="Any kind"
                value={kind || undefined}
                onChange={(next: string | undefined) => set({ kind: next ?? null })}
                options={(detail?.kinds ?? []).map((item) => ({
                  value: item.key,
                  label: item.key.charAt(0) + item.key.slice(1).toLowerCase(),
                }))}
              />
              <Select
                aria-label="Label"
                style={{ minWidth: 150 }}
                allowClear
                showSearch
                placeholder="Any label"
                value={label || undefined}
                onChange={(next: string | undefined) => set({ label: next ?? null })}
                // What is on the board, not a text box that matches nothing.
                options={(detail?.labels ?? []).map((item) => ({ value: item, label: item }))}
              />
              <div style={{ minWidth: 220 }}>
                <PeoplePicker
                  multiple={false}
                  aria-label="Assignee"
                  placeholder="Anybody"
                  value={assignee ? [assignee] : []}
                  onChange={(ids) => set({ assignee: ids[0] ?? null })}
                />
              </div>
              {filtered && (
                <Button
                  type="text"
                  onClick={() => {
                    setTerm("");
                    set({ label: null, kind: null, assignee: null, q: null });
                  }}
                >
                  Clear
                </Button>
              )}
            </Space>
          </Card>

          {board.isLoading && !detail ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : board.isError ? (
            <Alert
              type="error"
              showIcon
              message={
                board.error instanceof ApiError
                  ? board.error.message
                  : "That board could not be opened."
              }
            />
          ) : (
            <>
              {detail && detail.unplaced.length > 0 && (
                <Alert
                  className="nu-block"
                  type="warning"
                  showIcon
                  message={`${detail.unplaced.length} card${detail.unplaced.length === 1 ? "" : "s"} in no lane`}
                  description="A lane was removed while this page was open. Drag them somewhere."
                />
              )}

              <div className="nu-board" data-testid="kanban-board">
                {(detail?.lanes ?? []).map((lane) => (
                  <LaneColumn
                    key={lane.id}
                    lane={lane}
                    canEdit={canEdit}
                    onOpenCard={setOpenCard}
                    onMove={(cardId, position) =>
                      move.mutate({ id: cardId, laneId: lane.id, position })
                    }
                    // The keyboard route and the drag go through one mutation:
                    // two calls would be two behaviours, and the one nobody
                    // uses by hand is the one that breaks unnoticed (§64).
                    onMoveToLane={(cardId, laneId) =>
                      move.mutate({ id: cardId, laneId, position: 0 })
                    }
                    onAddCard={(title) => addCard.mutate({ laneId: lane.id, title })}
                    onChange={(input) => editLane.mutate({ id: lane.id, input })}
                    onRemove={(moveTo) => dropLane.mutate({ id: lane.id, moveTo })}
                    others={(detail?.lanes ?? []).filter((item) => item.id !== lane.id)}
                  />
                ))}

                {canEdit && (
                  <button
                    type="button"
                    className="nu-lane-add"
                    onClick={promptForLane}
                    data-testid="add-lane"
                  >
                    <PlusOutlined />
                    <span>Add a lane</span>
                  </button>
                )}
              </div>

              {detail && detail.lanes.every((lane) => lane.cards.length === 0) && (
                <Card size="small" className="nu-block">
                  <EmptyState
                    title={filtered ? "Nothing matches those filters" : "This board is empty"}
                    hint={
                      filtered
                        ? "Clear a filter, or search for something else."
                        : "Add a card to a lane — an epic to plan with, or a task to get on with."
                    }
                  />
                </Card>
              )}
            </>
          )}
        </>
      )}

      <NewBoardModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          set({ board: created.id });
          invalidate();
        }}
      />

      <CardDrawer
        cardId={openCard}
        onClose={() => setOpenCard(null)}
        onChanged={invalidate}
      />
    </>
  );

  function promptForLane(): void {
    let name = "";
    modal.confirm({
      title: "Add a lane",
      content: (
        <Input
          autoFocus
          placeholder="Blocked"
          aria-label="Lane name"
          onChange={(event) => {
            name = event.target.value;
          }}
        />
      ),
      okText: "Add",
      onOk: async () => {
        if (name.trim()) await addLane.mutateAsync(name.trim());
      },
    });
  }
}

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
