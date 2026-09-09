/**
 * `/files` — the file manager (§20).
 *
 * One decision shapes the page as much as it shapes the service: **the bytes
 * never pass through the API**. A drop asks for a presigned URL per file and
 * PUTs straight at object storage, then tells the API it is done. So this page
 * owns something most pages do not — a transfer with its own progress, its own
 * failure, and its own retry — and that is what the upload tray is for.
 *
 * Three decisions worth stating.
 *
 * **Per-file progress, not one spinner.** A drop of forty files with a single
 * indeterminate bar is a page somebody watches for four minutes wondering
 * whether it is stuck. Each file reports its own bytes, and one that fails says
 * so without taking the others down with it.
 *
 * **The tree is flat on the wire and nested here.** `path` is materialised, so
 * nesting is a string split rather than a traversal — and the client needs to
 * expand, collapse and highlight, which a recursive JSON structure makes
 * harder rather than easier.
 *
 * **The store says what it is.** When the local-directory fallback is in use,
 * the page says so: it streams every byte through the API, which is fine on a
 * laptop and worth knowing about anywhere else.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Input,
  Dropdown,
  Modal,
  Progress,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Tree,
  Typography,
  Upload,
} from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FolderAddOutlined,
  InboxOutlined,
  MoreOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { FilePreview } from "@/components/files/FilePreview";

import { ApiError } from "@/api/client";
import {
  filesApi,
  putBytes,
  readableSize,
  type FileFolder,
  type StoredFile,
} from "@/api/files";
import { PageHeader } from "@/components/PageHeader";
import { StatusTag } from "@/components/StatusTag";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { relativeTime } from "@/lib/time";

const { Text } = Typography;

/** Where the reader is in the tree. `unfiled` is a real place, not an absence. */
const UNFILED = "unfiled";

/** One transfer in flight, as the tray shows it. */
interface Transfer {
  id: string;
  name: string;
  size: number;
  progress: number;
  state: "uploading" | "done" | "failed";
  error?: string;
}

export default function FilesPage() {
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  // Which folder is open lives in the address (§69, §72), so "look in
  // /contracts" is a link rather than a set of instructions. Empty until the
  // tree answers, and then the first folder — a file manager that opens on
  // "Unfiled" opens on an empty list, because almost everything is filed.
  const [params, setParams] = useSearchParams();
  const folderId = params.get("folder") ?? "";
  const setFolderId = (next: string) =>
    setParams(
      (current) => {
        const replacement = new URLSearchParams(current);
        replacement.set("folder", next);
        return replacement;
      },
      { replace: true },
    );
  /**
   * Which file the pane is showing — in the *address*, not in state (§69).
   *
   * So "look at this one" is a link, the back button closes the pane, and a
   * reload lands where the reader was. It is also what "copy link" copies.
   */
  const previewing = params.get("file") ?? "";
  const setPreviewing = (next: string) =>
    setParams(
      (current) => {
        const replacement = new URLSearchParams(current);
        if (next) replacement.set("file", next);
        else replacement.delete("file");
        return replacement;
      },
      { replace: true },
    );
  const [search, setSearch] = useState("");
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [renaming, setRenaming] = useState<StoredFile | null>(null);
  const term = useDebouncedValue(search, 280);

  const tree = useQuery({
    queryKey: ["files-tree"],
    queryFn: ({ signal }) => filesApi.tree(signal),
  });

  const open = folderId || tree.data?.folders[0]?.id || UNFILED;

  const files = useQuery({
    queryKey: ["files", open, term],
    queryFn: ({ signal }) => filesApi.list({ folder_id: open, q: term || undefined }, signal),
    enabled: Boolean(tree.data),
    placeholderData: (previous) => previous,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["files"] });
    void queryClient.invalidateQueries({ queryKey: ["files-tree"] });
  };

  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : String(error));

  /**
   * One file, all the way: ask, upload, confirm.
   *
   * Sequential per file but concurrent across them, which is what a browser is
   * good at — and each stage reports into the tray so a failure names the file
   * it happened to rather than the drop.
   */
  const send = async (file: File) => {
    const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTransfers((current) => [
      ...current,
      { id, name: file.name, size: file.size, progress: 0, state: "uploading" },
    ]);
    const mark = (change: Partial<Transfer>) =>
      setTransfers((current) =>
        current.map((item) => (item.id === id ? { ...item, ...change } : item)),
      );

    try {
      const ticket = await filesApi.beginUpload({
        name: file.name,
        size_bytes: file.size,
        mime_type: file.type,
        folder_id: open === UNFILED ? null : open,
      });
      await putBytes(ticket, file, (fraction) => mark({ progress: Math.round(fraction * 100) }));
      // Confirmed, not assumed: the API checks the object is there before the
      // file becomes visible to anybody else.
      await filesApi.confirmUpload(ticket.file.id);
      mark({ progress: 100, state: "done" });
      refresh();
    } catch (error) {
      mark({
        state: "failed",
        error: error instanceof ApiError ? error.message : String(error),
      });
    }
  };

  const download = useMutation({
    mutationFn: (file: StoredFile) => filesApi.downloadUrl(file.id),
    onSuccess: (answer) => {
      // The browser fetches the bytes itself, from storage — which is the
      // whole point of the signed URL.
      //
      // An anchor rather than `window.open`: the URL carries
      // `Content-Disposition: attachment`, so the browser downloads and stays
      // on this page, and a popup for a download is the sort of thing popup
      // blockers exist to stop.
      const link = document.createElement("a");
      link.href = answer.download.url;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
      refresh();
    },
    onError: failed,
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => filesApi.update(id, { name }),
    onSuccess: () => {
      setRenaming(null);
      refresh();
    },
    onError: failed,
  });

  const move = useMutation({
    mutationFn: ({ id, folder }: { id: string; folder: string | null }) =>
      filesApi.update(id, { folder_id: folder }),
    onSuccess: refresh,
    onError: failed,
  });

  const remove = useMutation({
    mutationFn: (file: StoredFile) => filesApi.remove(file.id),
    onSuccess: (gone) => {
      message.success(`${gone.name} deleted`);
      refresh();
    },
    onError: failed,
  });

  const addFolder = useMutation({
    mutationFn: (name: string) =>
      filesApi.createFolder({ name, parent_id: open === UNFILED ? null : open }),
    onSuccess: (folder) => {
      setFolderId(folder.id);
      refresh();
    },
    onError: failed,
  });

  const dropFolder = useMutation({
    mutationFn: (id: string) => filesApi.removeFolder(id),
    onSuccess: () => {
      setFolderId(UNFILED);
      refresh();
    },
    onError: failed,
  });

  /** The flat list, nested by its materialised paths. */
  const nodes = useMemo(() => {
    const folders = tree.data?.folders ?? [];
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const children = new Map<string, FileFolder[]>();
    for (const folder of folders) {
      const key = folder.parent_id && byId.has(folder.parent_id) ? folder.parent_id : "";
      children.set(key, [...(children.get(key) ?? []), folder]);
    }

    const build = (parent: string): { key: string; title: React.ReactNode; children?: unknown[] }[] =>
      (children.get(parent) ?? []).map((folder) => ({
        key: folder.id,
        title: (
          <Space size={6}>
            <span>{folder.name}</span>
            <Text type="secondary">{folder.file_count}</Text>
          </Space>
        ),
        children: build(folder.id),
      }));

    return [
      {
        key: UNFILED,
        title: (
          <Space size={6}>
            <span>Unfiled</span>
            <Text type="secondary">{tree.data?.unfiled.file_count ?? 0}</Text>
          </Space>
        ),
      },
      ...build(""),
    ];
  }, [tree.data]);

  const canManage = tree.data?.can_manage ?? false;

  /** What the whole store holds — summed here rather than asked for twice. */
  const stored = useMemo(() => {
    const folders = tree.data?.folders ?? [];
    const unfiled = tree.data?.unfiled ?? { file_count: 0, total_bytes: 0 };
    return {
      files: folders.reduce((sum, folder) => sum + folder.file_count, unfiled.file_count),
      bytes: folders.reduce((sum, folder) => sum + folder.total_bytes, unfiled.total_bytes),
    };
  }, [tree.data]);

  const openFolder = tree.data?.folders.find((folder) => folder.id === open);
  const folderName = open === UNFILED ? "Unfiled" : (openFolder?.path ?? "");

  /**
   * Why this folder cannot be deleted, when it cannot.
   *
   * The service refuses a folder that is not empty, deliberately: a recursive
   * delete of a tree of files is a mistake somebody makes once and cannot
   * undo. So the reason is said here rather than discovered as a 409 after the
   * confirmation has been agreed to (§76). Unfiled is not a folder at all.
   */
  const undeletable = useMemo(() => {
    if (open === UNFILED) return "Unfiled is where loose files live — it is not a folder";
    if (!openFolder) return "No folder is open";
    const children = (tree.data?.folders ?? []).filter(
      (folder) => folder.parent_id === openFolder.id,
    ).length;
    if (openFolder.file_count > 0 || children > 0) {
      return "Only an empty folder can go — move or delete what is in it first";
    }
    return null;
  }, [open, openFolder, tree.data]);

  usePageCommands("files", [
    {
      id: "files.folder",
      label: "Create a folder",
      keywords: "new directory",
      run: () => promptForFolder(),
    },
    {
      id: "files.unfiled",
      label: "Show the unfiled files",
      keywords: "loose root",
      run: () => setFolderId(UNFILED),
    },
  ]);

  function promptForFolder(): void {
    let name = "";
    modal.confirm({
      title: "New folder",
      content: (
        <Input
          autoFocus
          placeholder="Contracts"
          aria-label="Folder name"
          onChange={(event) => {
            name = event.target.value;
          }}
        />
      ),
      okText: "Create",
      onOk: async () => {
        if (name.trim()) await addFolder.mutateAsync(name.trim());
      },
    });
  }

  if (tree.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (tree.isError) {
    const error = tree.error;
    const api = error instanceof ApiError ? error : null;
    return (
      <>
        <PageHeader title="Files" />
        <Alert
          type={api?.isForbidden ? "warning" : "error"}
          showIcon
          message={api?.message ?? "The library could not be loaded"}
          description={
            api ? (
              <Space direction="vertical" size={4}>
                {api.missingPermissions.length > 0 && (
                  <Text type="secondary">Missing: {api.missingPermissions.join(", ")}</Text>
                )}
                <Text code copyable={{ text: api.correlationId }}>
                  {api.correlationId}
                </Text>
              </Space>
            ) : undefined
          }
        />
      </>
    );
  }

  const active = transfers.filter((item) => item.state === "uploading");

  return (
    <>
      <PageHeader
        title="Files"
        subtitle="Bytes go straight between your browser and object storage — the API only signs the URL and records what happened."
        tag={
          tree.data?.store === "local" ? (
            <Tooltip title="No object storage is configured, so the API is serving the bytes itself. Fine on a laptop; worth knowing anywhere else.">
              <Tag color="warning">local store</Tag>
            </Tooltip>
          ) : undefined
        }
        actions={
          <Tooltip title={canManage ? "" : "Your role does not include files.manage"}>
            <Space size={8}>
              <Button
                icon={<FolderAddOutlined />}
                disabled={!canManage}
                onClick={promptForFolder}
                data-testid="new-folder"
              >
                New folder
              </Button>
              {/* The picker lives in the header, so the *permanent* invitation
                  to upload costs one button rather than a full-width band of
                  instructions above the files somebody came to read. */}
              <Upload
                multiple
                showUploadList={false}
                disabled={!canManage}
                customRequest={({ file }) => void send(file as File)}
              >
                <Button type="primary" icon={<UploadOutlined />} disabled={!canManage}>
                  Upload files
                </Button>
              </Upload>
            </Space>
          </Tooltip>
        }
      />

      {/* A workbench: the folders beside what is in them, filling the window.
          Sized to its content, this page left two thirds of the screen empty
          on a folder holding one file, and put the scrollbar on the whole page
          rather than on the column that is actually long. */}
      <div className="nu-split nu-split--rail nu-fill">
        <Card size="small" className="nu-pane nu-split-list" title="Folders" data-testid="folder-tree">
          <Tree
            blockNode
            defaultExpandAll
            selectedKeys={[open]}
            treeData={nodes as never}
            onSelect={(keys) => setFolderId(String(keys[0] ?? UNFILED))}
          />

          {/* At the foot of the rail rather than in the page header: it is
              what the *whole* store holds, which is the one fact about this
              page that belongs nowhere in particular — and thirteen short
              folder names left the column two thirds empty. */}
          <div className="nu-rail-foot">
            <Text type="secondary">
              {stored.files.toLocaleString()} {stored.files === 1 ? "file" : "files"} ·{" "}
              {readableSize(stored.bytes)}
            </Text>
            <Text type="secondary">
              {tree.data?.store === "local" ? "served by the API" : "object storage"}
            </Text>
          </div>
        </Card>

        <Card
          size="small"
          className="nu-pane nu-pane--table"
          data-testid="file-list"
          title={
            <Space size={8}>
              <Text strong data-testid="folder-name">
                {folderName}
              </Text>
              <Text type="secondary" data-testid="file-total">
                {files.data?.total ?? 0} {files.data?.total === 1 ? "file" : "files"}
              </Text>
            </Space>
          }
          extra={
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
                  size="small"
                  icon={<MoreOutlined />}
                  loading={dropFolder.isPending}
                  aria-label={`Actions for ${folderName}`}
                  data-testid="delete-folder"
                />
              </Dropdown>
            </Space>
          }
        >
          {transfers.length > 0 && (
            <div className="nu-transfers" data-testid="upload-tray">
              <div className="nu-transfers-head">
                <Text strong>{active.length > 0 ? `Uploading ${active.length}` : "Uploads"}</Text>
                <Button type="text" size="small" onClick={() => setTransfers([])}>
                  Clear
                </Button>
              </div>
              {/* Per file, not one bar for the drop: a failure names the file
                  it happened to, and the rest carry on. */}
              {transfers.map((transfer) => (
                <div key={transfer.id} className="nu-transfer">
                  <div className="nu-transfer-name">
                    <Text ellipsis>{transfer.name}</Text>
                    <Text type="secondary">{readableSize(transfer.size)}</Text>
                  </div>
                  <Progress
                    percent={transfer.progress}
                    size="small"
                    status={
                      transfer.state === "failed"
                        ? "exception"
                        : transfer.state === "done"
                          ? "success"
                          : "active"
                    }
                    aria-label={`${transfer.name}: ${transfer.progress}%`}
                  />
                  {transfer.error && (
                    <Text type="danger" style={{ fontSize: 12 }}>
                      {transfer.error}
                    </Text>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* The whole list is the drop target, and says so only while
              something is being dragged over it. A permanent band of
              instructions is chrome that is read once and then occupies a
              tenth of the page forever. */}
          <DropArea enabled={canManage} onFiles={send} limit={tree.data?.max_upload_bytes ?? 0}>
            <Table<StoredFile>
              size="small"
              rowKey="id"
              sticky
              // A row opens the preview, the way a row opens a record
              // everywhere else — the buttons at its end stop the click, so
              // "download" does not also open a pane over the download.
              onRow={(row) => ({
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
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      term
                        ? "Nothing here matches that"
                        : canManage
                          ? "Nothing here yet — drop files in, or use Upload files"
                          : "Nothing here yet"
                    }
                  />
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
                { title: "Kind", dataIndex: "kind", width: 120 },
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
                          size="small"
                          aria-label={`Download ${row.name}`}
                          icon={<DownloadOutlined />}
                          loading={download.isPending}
                          onClick={() => download.mutate(row)}
                        />
                      </Tooltip>
                      <Tooltip title={canManage ? "Rename" : "Needs files.manage"}>
                        <Button
                          type="text"
                          size="small"
                          disabled={!canManage}
                          aria-label={`Rename ${row.name}`}
                          icon={<EditOutlined />}
                          onClick={() => setRenaming(row)}
                        />
                      </Tooltip>
                      <Tooltip title={canManage ? "Delete" : "Needs files.manage"}>
                        <Button
                          type="text"
                          size="small"
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
          </DropArea>
        </Card>
      </div>

      {/* Shown rather than downloaded, for the three kinds a browser can
          render honestly (§20, §64). */}
      <FilePreview
        open={Boolean(previewing)}
        file={(files.data?.items ?? []).find((item) => item.id === previewing) ?? null}
        onClose={() => setPreviewing("")}
        onDownload={(file) => download.mutate(file)}
      />

      <RenameModal
        file={renaming}
        folders={tree.data?.folders ?? []}
        saving={rename.isPending || move.isPending}
        onClose={() => setRenaming(null)}
        onSave={(name, folder) => {
          if (!renaming) return;
          if (name !== renaming.name) rename.mutate({ id: renaming.id, name });
          if (folder !== (renaming.folder_id ?? UNFILED)) {
            move.mutate({ id: renaming.id, folder: folder === UNFILED ? null : folder });
          }
          setRenaming(null);
        }}
      />
    </>
  );
}

/**
 * The file list, which is also where files are dropped.
 *
 * A dedicated drop panel is chrome that is read once and then occupies a tenth
 * of the page forever — and on a folder with one file in it, the instructions
 * were taller than the content. So the list itself takes the drop and says so
 * only while something is being dragged over it, with the *permanent* way to
 * upload being the button in the header.
 *
 * Written here rather than with `Upload.Dragger` because the dragger is a
 * bordered, centred box with its own padding: everything that makes it a good
 * panel makes it a bad wrapper for a table. The events are four lines, and the
 * hidden input a table cannot supply lives on the header's `Upload`.
 */
function DropArea({
  enabled,
  limit,
  onFiles,
  children,
}: {
  enabled: boolean;
  limit: number;
  onFiles: (file: File) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);

  if (!enabled) return <>{children}</>;

  return (
    <div
      className={`nu-drop-area${over ? " is-over" : ""}`}
      data-testid="dropzone"
      // `dragover` must be cancelled or the browser navigates to the file.
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        // Only when the pointer has left the area itself: a `dragleave` fires
        // for every child it crosses, which flickers the hint off and on.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        for (const file of Array.from(event.dataTransfer.files)) onFiles(file);
      }}
    >
      {children}
      {over && (
        <div className="nu-drop-hint" aria-hidden>
          <InboxOutlined />
          <span>
            Drop to upload · up to {readableSize(limit)} each · executables refused before
            anything is transferred
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Rename and move, in one dialog.
 *
 * Both, because they are the same thought — "this is in the wrong place and
 * called the wrong thing" — and because neither touches the object: a storage
 * key is an address, not a path.
 */
function RenameModal({
  file,
  folders,
  saving,
  onClose,
  onSave,
}: {
  file: StoredFile | null;
  folders: FileFolder[];
  saving: boolean;
  onClose: () => void;
  onSave: (name: string, folderId: string) => void;
}) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState(UNFILED);

  return (
    <Modal
      open={file !== null}
      title={`Rename ${file?.name ?? ""}`}
      okText="Save"
      confirmLoading={saving}
      afterOpenChange={(open) => {
        if (open && file) {
          setName(file.name);
          setFolder(file.folder_id ?? UNFILED);
        }
      }}
      onCancel={onClose}
      onOk={() => onSave(name.trim() || (file?.name ?? ""), folder)}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <div>
          <Text strong className="nu-field-label">
            Name
          </Text>
          <Input
            value={name}
            aria-label="File name"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <Text strong className="nu-field-label">
            Folder
          </Text>
          <Select
            style={{ width: "100%" }}
            aria-label="Folder"
            value={folder}
            onChange={setFolder}
            options={[
              { value: UNFILED, label: "Unfiled" },
              ...folders.map((item) => ({ value: item.id, label: item.path })),
            ]}
          />
        </div>
      </Space>
    </Modal>
  );
}
