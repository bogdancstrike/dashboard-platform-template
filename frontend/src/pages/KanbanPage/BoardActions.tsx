import { Button, Dropdown, Select, Space, Tooltip } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, SettingOutlined } from "@ant-design/icons";

import { kanbanApi } from "@/api/kanban";

import type { KanbanPageModel } from "./useKanbanPage";

/** The board picker, the board menu (add a lane, archive, delete) and New board. */
export function BoardActions({ m, canCreate }: { m: KanbanPageModel; canCreate: boolean }) {
  const { modal, setCreating, setNamingLane, set, boards, chosen, detail, canEdit, invalidate, failed } = m;
  return (
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
              if (key === "lane") setNamingLane(true);
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
  );
}
