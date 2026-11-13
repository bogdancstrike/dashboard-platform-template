import { Button, Space, Tooltip, Typography } from "antd";
import { DeleteOutlined, DownloadOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { filesApi } from "@/api/files";

import type { FilesPageModel } from "./useFilesPage";

/** What can be done to the ticked files at once: download, move, delete. */
export function BulkBar({ m }: { m: FilesPageModel }) {
  const { modal, ticked, setTicked, setMovingTo, bulk, canManage } = m;
  const { Text } = Typography;
  return (
    <>
      {ticked.length > 0 && (
        <div className="nu-bulkbar" data-testid="file-bulk">
          <Text strong>
            {ticked.length} {ticked.length === 1 ? "file" : "files"} selected
          </Text>
          <Space size={8}>
            <Button
              icon={<FolderOpenOutlined />}
              disabled={!canManage}
              onClick={() => setMovingTo(true)}
              data-testid="bulk-move"
            >
              Move to…
            </Button>
            <Button
              icon={<DownloadOutlined />}
              loading={bulk.isPending}
              onClick={() =>
                bulk.mutate({
                  ids: ticked,
                  // The same signed-URL path a single download takes, once
                  // per file: the browser fetches the bytes from storage,
                  // which is what makes a forty-file download possible.
                  act: async (id) => {
                    const answer = await filesApi.downloadUrl(id);
                    const link = document.createElement("a");
                    link.href = answer.download.url;
                    link.rel = "noopener";
                    document.body.append(link);
                    link.click();
                    link.remove();
                  },
                })
              }
              data-testid="bulk-download"
            >
              Download
            </Button>
            <Tooltip title={canManage ? "" : "Your role does not include files.manage"}>
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={!canManage}
                loading={bulk.isPending}
                onClick={() =>
                  modal.confirm({
                    title: `Delete ${ticked.length} ${ticked.length === 1 ? "file" : "files"}?`,
                    content:
                      "The records and the bytes both go. The audit trail keeps what they were.",
                    okText: `Delete ${ticked.length}`,
                    okButtonProps: { danger: true },
                    onOk: () =>
                      bulk.mutateAsync({
                        ids: ticked,
                        act: (id) => filesApi.remove(id),
                      }),
                  })
                }
                data-testid="bulk-delete"
              >
                Delete
              </Button>
            </Tooltip>
            <Button type="text" onClick={() => setTicked([])}>
              Clear
            </Button>
          </Space>
        </div>
      )}
    </>
  );
}
