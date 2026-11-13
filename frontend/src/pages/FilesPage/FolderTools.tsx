import { Button, Input, Dropdown, Space } from "antd";
import { DeleteOutlined, MoreOutlined } from "@ant-design/icons";

import type { FilesPageModel } from "./useFilesPage";

/** Search the open folder, and the folder's own menu — delete, only when it is empty. */
export function FolderTools({ m }: { m: FilesPageModel }) {
  const { modal, search, setSearch, open, dropFolder, canManage, folderName, undeletable } = m;
  return (
    <Space size={8}>
      <Input.Search
        allowClear
        placeholder="Search this folder"
        aria-label="Search files"
        style={{ width: 220 }}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {/* Behind a menu, not beside the search box. Deleting a folder
          was the loudest control on the page — a red button one slip
          away from a filter somebody types into all day. */}
      <Dropdown
        trigger={["click"]}
        disabled={!canManage}
        menu={{
          items: [
            {
              key: "delete",
              icon: <DeleteOutlined />,
              danger: !undeletable,
              disabled: Boolean(undeletable),
              label: undeletable
                ? `Delete this folder — ${undeletable}`
                : "Delete this folder",
            },
          ],
          onClick: () => {
            modal.confirm({
              title: `Delete ${folderName}?`,
              content: "It is empty, so nothing is lost with it.",
              okText: "Delete folder",
              okButtonProps: { danger: true },
              onOk: async () => {
                await dropFolder.mutateAsync(open);
              },
            });
          },
        }}
      >
        <Button
          icon={<MoreOutlined />}
          loading={dropFolder.isPending}
          aria-label={`Actions for ${folderName}`}
          data-testid="delete-folder"
        />
      </Dropdown>
    </Space>
  );
}
