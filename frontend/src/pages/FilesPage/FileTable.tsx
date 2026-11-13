import { Button, Space, Table, Tooltip, Typography } from "antd";
import { DeleteOutlined, DownloadOutlined, EditOutlined } from "@ant-design/icons";
import { readableSize, type StoredFile } from "@/api/files";
import { StatusTag } from "@/components/StatusTag";
import { relativeTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";

import type { FilesPageModel } from "./useFilesPage";

/** The open folder's files: preview, download, rename, move and delete, ticked for bulk. */
export function FileTable({ m }: { m: FilesPageModel }) {
  const { modal, previewing, setPreviewing, setRenaming, ticked, setTicked, term, files, download, remove, canManage } = m;
  const { Text } = Typography;
  return (
    <Table<StoredFile>
      className="nx-rec-table"
      size="small"
      rowKey="id"
      sticky
      rowSelection={{
        selectedRowKeys: ticked,
        onChange: (keys) => setTicked(keys.map(String)),
        // Kept across paging and across a search: somebody who ticks
        // four files, searches for a fifth and ticks it means five.
        preserveSelectedRowKeys: true,
      }}
      // Dragged by the row, dropped on a folder in the rail. The
      // selection comes with it when the dragged row is part of one,
      // so "move these nine" is one gesture rather than nine.
      onRow={(row) => ({
        draggable: canManage,
        onDragStart: (event: React.DragEvent) => {
          const carried = ticked.includes(row.id) ? ticked : [row.id];
          event.dataTransfer.setData("text/plain", carried.join(","));
          event.dataTransfer.effectAllowed = "move";
        },
        // A row opens the preview, the way a row opens a record
        // everywhere else — the buttons at its end stop the click, so
        // "download" does not also open a pane over the download.
        onClick: () => setPreviewing(row.id),
        style: { cursor: "pointer" },
      })}
      rowClassName={(row) => (row.id === previewing ? "nu-row-selected" : "")}
      loading={files.isLoading}
      dataSource={files.data?.items ?? []}
      pagination={
        (files.data?.total ?? 0) > (files.data?.page_size ?? 50)
          ? { total: files.data?.total, pageSize: files.data?.page_size, simple: true }
          : false
      }
      locale={{
        emptyText: (
          <EmptyState compact title={
              term
                ? "Nothing here matches that"
                : canManage
                  ? "Nothing here yet — drop files in, or use Upload files"
                  : "Nothing here yet"
            } />
        ),
      }}
      columns={[
        {
          title: "Name",
          dataIndex: "name",
          // `ellipsis` on the column, not only on the `Text` inside
          // it: AntD lays a table out `auto` until a column asks for
          // fixed, and in `auto` the name cell simply grew until it
          // overlapped the one beside it.
          ellipsis: true,
          render: (name: string, row) => (
            <span className="nu-file-name">
              <Text ellipsis={{ tooltip: name }}>{name}</Text>
              {row.status !== "READY" && <StatusTag status={row.status} />}
            </span>
          ),
        },
        {
          title: "Kind",
          dataIndex: "kind",
          width: 120,
          render: (kind: string | null) => (kind ? <StatusTag status={kind} tone="neutral" /> : "—"),
        },
        {
          title: "Size",
          dataIndex: "size_bytes",
          width: 90,
          align: "right",
          render: (bytes: number) => readableSize(bytes),
        },
        { title: "Owner", dataIndex: "owner", width: 150, ellipsis: true },
        {
          title: "Added",
          dataIndex: "created_at",
          width: 110,
          render: (value: string | null) => relativeTime(value),
        },
        {
          title: "",
          width: 112,
          align: "right",
          render: (_value, row) => (
            // The row opens the preview; these do their own thing.
            <Space size={2} onClick={(event) => event.stopPropagation()}>
              <Tooltip title="Download">
                <Button
                  type="text"
                  aria-label={`Download ${row.name}`}
                  icon={<DownloadOutlined />}
                  loading={download.isPending}
                  onClick={() => download.mutate(row)}
                />
              </Tooltip>
              <Tooltip title={canManage ? "Rename" : "Needs files.manage"}>
                <Button
                  type="text"
                  disabled={!canManage}
                  aria-label={`Rename ${row.name}`}
                  icon={<EditOutlined />}
                  onClick={() => setRenaming(row)}
                />
              </Tooltip>
              <Tooltip title={canManage ? "Delete" : "Needs files.manage"}>
                <Button
                  type="text"
                  danger
                  disabled={!canManage}
                  aria-label={`Delete ${row.name}`}
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    modal.confirm({
                      title: `Delete ${row.name}?`,
                      content:
                        "The record and the bytes both go. The audit trail keeps what it was.",
                      okText: "Delete",
                      okButtonProps: { danger: true },
                      onOk: async () => {
                        await remove.mutateAsync(row);
                      },
                    })
                  }
                />
              </Tooltip>
            </Space>
          ),
        },
      ]}
    />
  );
}
