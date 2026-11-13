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

import { Alert, Button, Card, Skeleton, Space, Tag, Tooltip, Typography, Upload } from "antd";
import { FolderAddOutlined, UploadOutlined } from "@ant-design/icons";

import { FilePreview } from "@/components/files/FilePreview";

import { ApiError } from "@/api/client";
import { NameModal } from "@/components/NameModal";
import { PageHeader } from "@/components/PageHeader";
import { apiErrorDetails } from "@/components/feedback/apiErrorDetails";

import { DropArea } from "./DropArea";
import { RenameModal } from "./RenameModal";
import { UNFILED } from "./transfers";

const { Text } = Typography;

import { FolderRail } from "./FolderRail";
import { TransferTray } from "./TransferTray";
import { BulkBar } from "./BulkBar";
import { FileTable } from "./FileTable";
import { MoveModal } from "./MoveModal";
import { useFilesPage } from "./useFilesPage";
import { FolderTools } from "./FolderTools";

export default function FilesPage() {
  const m = useFilesPage();
  const { tableBox, previewing, setPreviewing, renaming, setRenaming, namingFolder, setNamingFolder, tree, parentName, files, send, download, rename, move, addFolder, canManage, folderName } = m;

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
          description={apiErrorDetails(api)}
        />
      </>
    );
  }

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
                onClick={() => setNamingFolder(true)}
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
        <FolderRail m={m} />

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
          extra={<FolderTools m={m} />}
        >
          <TransferTray m={m} />

          {/* Above the rows it acts on, and only once something is ticked —
              the same rule the explorer's bulk bar follows. A bar that is
              always there is a bar nobody reads when it matters. */}
          <BulkBar m={m} />

          {/* The whole list is the drop target, and says so only while
              something is being dragged over it. A permanent band of
              instructions is chrome that is read once and then occupies a
              tenth of the page forever. */}
          <div ref={tableBox} className="nx-files-tablebox">
          <DropArea enabled={canManage} onFiles={send} limit={tree.data?.max_upload_bytes ?? 0}>
            <FileTable m={m} />
          </DropArea>
          </div>
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

      <NameModal
        open={namingFolder}
        // Where it will land, because "New folder" while a folder is selected
        // creates a *child* — a file manager's habit, and one the reader has
        // to be told about before they press Create rather than after.
        title={parentName ? `New folder in ${parentName}` : "New folder"}
        label="Folder name"
        placeholder="Contracts"
        saving={addFolder.isPending}
        onClose={() => setNamingFolder(false)}
        onSubmit={(name) => {
          addFolder.mutate(name);
          setNamingFolder(false);
        }}
      />

      <MoveModal m={m} />

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
