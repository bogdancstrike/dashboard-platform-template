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

import { Alert, Button, Skeleton, Tag } from "antd";

import { ApiError } from "@/api/client";
import { BoardGallery } from "@/components/kanban/BoardGallery";
import { CardDrawer } from "@/components/kanban/CardDrawer";
import { NameModal } from "@/components/NameModal";
import { NewBoardModal } from "@/components/kanban/NewBoardModal";
import { PageHeader } from "@/components/PageHeader";

import { BoardActions } from "./BoardActions";
import { BoardFilters } from "./BoardFilters";
import { BoardLanes } from "./BoardLanes";
import { useKanbanPage } from "./useKanbanPage";

export { withCardMoved } from "./withCardMoved";

export default function KanbanPage() {
  const m = useKanbanPage();
  const { creating, setCreating, namingLane, setNamingLane, label, kind, assignee, search, openCard, setOpenCard, set, boards, chosen, board, detail, invalidate, addLane } = m;

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
            <Button onClick={() => void boards.refetch()}>
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
          <BoardActions m={m} canCreate={canCreate} />
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
          <BoardFilters m={m} filtered={filtered} />

          <BoardLanes m={m} filtered={filtered} />
        </>
      )}

      <NameModal
        open={namingLane}
        title="Add a lane"
        label="Lane name"
        placeholder="Blocked"
        okText="Add"
        saving={addLane.isPending}
        onClose={() => setNamingLane(false)}
        onSubmit={(name) => {
          addLane.mutate(name);
          setNamingLane(false);
        }}
      />

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
        priorities={board.data?.priorities ?? boards.data?.priorities ?? []}
        onClose={() => setOpenCard(null)}
        onChanged={invalidate}
      />
    </>
  );

}
