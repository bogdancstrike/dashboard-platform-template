import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Input, Popconfirm, Progress, Tooltip, Typography, Upload } from "antd";
import {
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";

import { filesApi, putBytes, readableSize } from "@/api/files";
import {
  failureText,
  isReading,
  knowledgeApi,
  type CollectionDetail,
  type DocumentStatus,
  type KnowledgeDocument,
} from "@/api/knowledge";
import { EmptyState } from "@/components/EmptyState";
import { NameModal } from "@/components/NameModal";
import { NxIcon } from "@/components/NxIcon";
import { StatusTag } from "@/components/StatusTag";
import { relativeTime } from "@/lib/time";
import { queryKeys } from "@/lib/queryKeys";

const { Text } = Typography;

/** The reading's stages, in order, as a reader names them. */
const STAGES: { status: DocumentStatus; label: string }[] = [
  { status: "QUEUED", label: "Queued" },
  { status: "PARSING", label: "Reading" },
  { status: "CHUNKING", label: "Splitting" },
  { status: "EMBEDDING", label: "Indexing" },
  { status: "READY", label: "Ready" },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((stage, index) => [stage.status, index])) as Record<string, number>;

const TONE: Record<string, "ok" | "warn" | "bad" | "acc" | "neutral"> = {
  QUEUED: "neutral",
  PARSING: "acc",
  CHUNKING: "acc",
  EMBEDDING: "acc",
  READY: "ok",
  FAILED: "bad",
};

/** The converter's own ceiling; the server refuses above it too. */
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

type TrayState = "uploading" | "adding" | "done" | "error" | "refused" | "cancelled";

interface TrayItem {
  key: string;
  file: File;
  state: TrayState;
  fraction: number;
  message?: string;
  controller?: AbortController;
}

/** Why a file cannot be read for questions, before a byte is sent — or nothing. */
export function refusal(file: File, supported: string[], maxBytes: number): string | null {
  const extension = extensionOf(file.name);
  if (!extension || !supported.includes(extension)) {
    return `${extension ? `.${extension}` : "This kind of"} file cannot be read for questions. Use PDF, Word, PowerPoint, Excel, HTML, Markdown or text.`;
  }
  if (file.size > maxBytes) {
    return `${readableSize(file.size)} is over the ${readableSize(maxBytes)} a document may be. Split it and upload the parts.`;
  }
  if (file.size === 0) return "The file is empty.";
  return null;
}

/**
 * The files of one collection (§44): drop several at once, watch each one
 * upload (cancel or retry it), then watch it being read — queued, reading,
 * splitting, indexing, ready — or see why it failed and read it again.
 */
export function DocumentsPanel({
  collection,
  supported,
  maxBytes = DEFAULT_MAX_BYTES,
  onPreview,
}: {
  collection: CollectionDetail;
  supported: string[];
  maxBytes?: number;
  onPreview: (document: KnowledgeDocument) => void;
}) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [term, setTerm] = useState("");
  const [renaming, setRenaming] = useState<KnowledgeDocument | null>(null);
  const counter = useRef(0);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeCollection(collection.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeCollections() });
  };
  const patch = (key: string, next: Partial<TrayItem>) =>
    setTray((items) => items.map((item) => (item.key === key ? { ...item, ...next } : item)));

  const reprocess = useMutation({
    mutationFn: (document: KnowledgeDocument) => knowledgeApi.reprocess(collection.id, document.id),
    onSuccess: () => {
      message.success("Reading it again");
      refresh();
    },
    onError: (error: Error) => message.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (document: KnowledgeDocument) => knowledgeApi.removeDocument(collection.id, document.id),
    onSuccess: () => {
      message.success("Removed from the collection — the file stays in Files");
      refresh();
    },
    onError: (error: Error) => message.error(error.message),
  });
  const rename = useMutation({
    mutationFn: ({ document, name }: { document: KnowledgeDocument; name: string }) =>
      filesApi.update(document.file.id!, { name }),
    onSuccess: () => {
      message.success("Renamed");
      setRenaming(null);
      refresh();
    },
    onError: (error: Error) => message.error(error.message),
  });

  async function send(item: TrayItem) {
    const controller = new AbortController();
    patch(item.key, { state: "uploading", fraction: 0, message: undefined, controller });
    try {
      const ticket = await filesApi.beginUpload({
        name: item.file.name,
        size_bytes: item.file.size,
        mime_type: item.file.type || undefined,
        folder_id: collection.folder_id,
      });
      await putBytes(ticket, item.file, (fraction) => patch(item.key, { fraction }), controller.signal);
      await filesApi.confirmUpload(ticket.file.id);
      patch(item.key, { state: "adding", fraction: 1 });
      await knowledgeApi.addDocuments(collection.id, [ticket.file.id]);
      patch(item.key, { state: "done", controller: undefined });
      refresh();
      // A finished upload leaves the tray: its reading is on the list below.
      window.setTimeout(() => setTray((items) => items.filter((entry) => entry.key !== item.key)), 1200);
    } catch (error) {
      const cancelled = controller.signal.aborted;
      patch(item.key, {
        state: cancelled ? "cancelled" : "error",
        message: cancelled ? "Cancelled" : (error as Error).message,
        controller: undefined,
      });
    }
  }

  function accept(files: File[]) {
    const items: TrayItem[] = files.map((file) => {
      counter.current += 1;
      const reason = refusal(file, supported, maxBytes);
      return {
        key: `u${counter.current}`,
        file,
        state: reason ? "refused" : "uploading",
        fraction: 0,
        message: reason ?? undefined,
      };
    });
    setTray((current) => [...current.filter((item) => item.state !== "done"), ...items]);
    for (const item of items) if (item.state !== "refused") void send(item);
  }

  const documents = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return needle
      ? collection.documents.filter((d) => d.file.name.toLowerCase().includes(needle))
      : collection.documents;
  }, [collection.documents, term]);
  const empty = collection.documents.length === 0;

  return (
    <div className="nx-kn-docs" data-testid="documents-panel">
      {collection.can_edit && (
        <Upload.Dragger
          multiple
          showUploadList={false}
          accept={supported.map((ext) => `.${ext}`).join(",")}
          beforeUpload={(file, list) => {
            // Called once per file with the whole list; act on the first call.
            if (file === list[0]) accept(list);
            return false;
          }}
          className={`nx-kn-drop${empty ? " is-empty" : ""}`}
          data-testid="documents-drop"
        >
          <div className="nx-kn-drop-inner">
            <span className="nx-kn-drop-icon">
              <NxIcon name="import" size={empty ? 26 : 20} />
            </span>
            <div>
              <Text strong className="nx-kn-drop-title">
                {empty ? "Drop the files people ask about" : "Drop more files, or click to choose"}
              </Text>
              <div>
                <Text type="secondary">
                  PDF, Word, PowerPoint, Excel, HTML, Markdown and text, up to {readableSize(maxBytes)} each —
                  read with their page numbers, so answers cite the page.
                </Text>
              </div>
            </div>
          </div>
        </Upload.Dragger>
      )}

      {tray.length > 0 && (
        <ul className="nx-kn-tray" data-testid="upload-tray" aria-live="polite">
          {tray.map((item) => (
            <li key={item.key} className={`nx-kn-tray-item is-${item.state}`} data-testid="upload-item" data-state={item.state}>
              <span className="nx-kn-doc-icon" aria-hidden>
                {extensionOf(item.file.name).toUpperCase().slice(0, 4) || "FILE"}
              </span>
              <div className="nx-kn-tray-main">
                <Text strong ellipsis>
                  {item.file.name}
                </Text>
                {item.state === "uploading" || item.state === "adding" ? (
                  <Progress
                    aria-label={`Uploading ${item.file.name}`}
                    percent={Math.round(item.fraction * 100)}
                    size="small"
                    status="active"
                    format={() => (item.state === "adding" ? "Adding…" : `${Math.round(item.fraction * 100)}%`)}
                  />
                ) : (
                  <Text
                    type={item.state === "done" ? "success" : item.state === "cancelled" ? "secondary" : "danger"}
                    className="nx-kn-doc-error"
                    data-testid="upload-message"
                  >
                    {item.state === "done" ? `Uploaded · ${readableSize(item.file.size)} — reading it now` : item.message}
                  </Text>
                )}
              </div>
              <div className="nx-kn-doc-actions">
                {item.state === "uploading" && (
                  <Button onClick={() => item.controller?.abort()} data-testid="upload-cancel">
                    Cancel
                  </Button>
                )}
                {(item.state === "error" || item.state === "cancelled") && (
                  <Button icon={<ReloadOutlined />} onClick={() => void send(item)} data-testid="upload-retry">
                    Retry
                  </Button>
                )}
                {item.state !== "uploading" && item.state !== "adding" && (
                  <Button
                    type="text"
                    shape="circle"
                    icon={<CloseOutlined />}
                    aria-label={`Dismiss ${item.file.name}`}
                    onClick={() => setTray((items) => items.filter((entry) => entry.key !== item.key))}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {empty && !tray.length ? (
        !collection.can_edit && (
          <EmptyState title="No documents yet" hint="The owner has not added any files to this collection yet." />
        )
      ) : (
        <>
          {collection.documents.length > 3 && (
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Find a document"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              className="nx-kn-docsearch"
              data-testid="documents-search"
            />
          )}
          {term && !documents.length && <Text type="secondary">No document is called that.</Text>}
          <ul className="nx-kn-doclist">
            {documents.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                canEdit={collection.can_edit}
                reprocessing={reprocess.isPending && reprocess.variables?.id === document.id}
                onPreview={() => onPreview(document)}
                onReprocess={() => reprocess.mutate(document)}
                onRename={() => setRenaming(document)}
                onRemove={() => remove.mutate(document)}
              />
            ))}
          </ul>
        </>
      )}

      <NameModal
        open={renaming !== null}
        title="Rename document"
        label="File name"
        okText="Rename"
        initial={renaming?.file.name ?? ""}
        saving={rename.isPending}
        onClose={() => setRenaming(null)}
        onSubmit={(name) => renaming && rename.mutate({ document: renaming, name })}
      />
    </div>
  );
}

function DocumentRow({
  document,
  canEdit,
  reprocessing,
  onPreview,
  onReprocess,
  onRename,
  onRemove,
}: {
  document: KnowledgeDocument;
  canEdit: boolean;
  reprocessing: boolean;
  onPreview: () => void;
  onReprocess: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  const reading = isReading(document);
  const stage = STAGE_INDEX[document.status] ?? 0;
  return (
    <li className="nx-kn-doc" data-testid="document-row" data-status={document.status}>
      <span className="nx-kn-doc-icon" aria-hidden>
        {(document.file.extension ?? "").toUpperCase().slice(0, 4) || "FILE"}
      </span>
      <div className="nx-kn-doc-main">
        <Text strong ellipsis className="nx-kn-doc-name">
          {document.file.name}
        </Text>
        <Text type="secondary" className="nx-kn-doc-meta">
          {[
            readableSize(document.file.size_bytes),
            document.pages ? `${document.pages} page${document.pages === 1 ? "" : "s"}` : null,
            document.status === "READY" ? `${document.chunk_count} passages` : null,
            document.ingested_at ? `read ${relativeTime(document.ingested_at)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {reading && (
          <ol className="nx-kn-steps" aria-label="Reading progress" data-testid="document-steps">
            {STAGES.map((item, index) => (
              <li key={item.status} className={index < stage ? "is-done" : index === stage ? "is-now" : ""}>
                {item.label}
              </li>
            ))}
          </ol>
        )}
        {document.status === "FAILED" && (
          <Text type="danger" className="nx-kn-doc-error" data-testid="document-error">
            {failureText(document.error_code, document.error_message)}
          </Text>
        )}
        {document.status === "READY" && document.warnings.some((w) => w.startsWith("EMBEDDINGS_UNAVAILABLE")) && (
          <Text type="warning" className="nx-kn-doc-error">
            Found by its words only — the AI index was unavailable when it was read.
          </Text>
        )}
        {document.stalled && (
          <Text type="warning" className="nx-kn-doc-error">
            Nothing has worked on this for a while. Read it again.
          </Text>
        )}
      </div>
      <StatusTag
        status={document.status}
        label={document.status === "FAILED" ? "Failed" : STAGES[stage]?.label}
        tone={TONE[document.status]}
        data-testid="document-status"
      />
      <div className="nx-kn-doc-actions">
        <Tooltip title="Preview">
          <Button
            type="text"
            shape="circle"
            icon={<EyeOutlined />}
            aria-label={`Preview ${document.file.name}`}
            disabled={!document.file.id}
            onClick={onPreview}
          />
        </Tooltip>
        {canEdit && (
          <Tooltip title="Rename">
            <Button
              type="text"
              shape="circle"
              icon={<EditOutlined />}
              aria-label={`Rename ${document.file.name}`}
              disabled={!document.file.id}
              onClick={onRename}
            />
          </Tooltip>
        )}
        {canEdit && !reading && (
          <Tooltip title="Read it again">
            <Button
              type="text"
              shape="circle"
              icon={<ReloadOutlined />}
              aria-label={`Reprocess ${document.file.name}`}
              loading={reprocessing}
              onClick={onReprocess}
            />
          </Tooltip>
        )}
        {canEdit && (
          <Popconfirm
            title="Take this file out of the collection?"
            description="The file itself stays in Files."
            okText="Remove"
            onConfirm={onRemove}
          >
            <Button
              type="text"
              shape="circle"
              danger
              icon={<DeleteOutlined />}
              aria-label={`Remove ${document.file.name}`}
            />
          </Popconfirm>
        )}
      </div>
    </li>
  );
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}
