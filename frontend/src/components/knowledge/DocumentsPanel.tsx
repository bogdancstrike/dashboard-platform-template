import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Popconfirm, Progress, Tooltip, Typography, Upload } from "antd";
import { DeleteOutlined, EyeOutlined, ReloadOutlined } from "@ant-design/icons";

import { filesApi, putBytes, readableSize } from "@/api/files";
import {
  failureText,
  isReading,
  knowledgeApi,
  type CollectionDetail,
  type KnowledgeDocument,
} from "@/api/knowledge";
import { EmptyState } from "@/components/EmptyState";
import { NxIcon } from "@/components/NxIcon";
import { StatusTag } from "@/components/StatusTag";
import { relativeTime } from "@/lib/time";

const { Text } = Typography;

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "Queued",
  PARSING: "Reading",
  EMBEDDING: "Indexing",
  READY: "Ready",
  FAILED: "Failed",
};

const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "acc" | "neutral"> = {
  QUEUED: "neutral",
  PARSING: "acc",
  EMBEDDING: "acc",
  READY: "ok",
  FAILED: "bad",
};

interface Uploading {
  name: string;
  fraction: number;
  error?: string;
}

/**
 * The files of one collection: drop to upload, and where each one's reading
 * stands — queued, reading, indexing, ready, or failed with the reason and a
 * button to try again (§44).
 */
export function DocumentsPanel({
  collection,
  supported,
  onPreview,
}: {
  collection: CollectionDetail;
  supported: string[];
  onPreview: (document: KnowledgeDocument) => void;
}) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["knowledge-collection", collection.id] });
    void queryClient.invalidateQueries({ queryKey: ["knowledge-collections"] });
  };

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

  async function upload(files: File[]) {
    const accepted = files.filter((file) => supported.includes(extensionOf(file.name)));
    const refused = files.length - accepted.length;
    if (refused) message.warning(`${refused} file(s) skipped — that kind cannot be read for questions.`);
    if (!accepted.length) return;
    setUploads(accepted.map((file) => ({ name: file.name, fraction: 0 })));
    const ids: string[] = [];
    await Promise.all(
      accepted.map(async (file, index) => {
        try {
          const ticket = await filesApi.beginUpload({
            name: file.name,
            size_bytes: file.size,
            mime_type: file.type || undefined,
            folder_id: collection.folder_id,
          });
          await putBytes(ticket, file, (fraction) =>
            setUploads((current) => current.map((u, i) => (i === index ? { ...u, fraction } : u))),
          );
          await filesApi.confirmUpload(ticket.file.id);
          ids.push(ticket.file.id);
        } catch (error) {
          setUploads((current) =>
            current.map((u, i) => (i === index ? { ...u, error: (error as Error).message } : u)),
          );
        }
      }),
    );
    if (ids.length) {
      try {
        await knowledgeApi.addDocuments(collection.id, ids);
        message.success(`${ids.length} file(s) added — reading them now`);
      } catch (error) {
        message.error((error as Error).message);
      }
    }
    setUploads((current) => current.filter((u) => u.error));
    refresh();
  }

  return (
    <div className="nx-kn-docs" data-testid="documents-panel">
      {collection.can_edit && (
        <Upload.Dragger
          multiple
          showUploadList={false}
          accept={supported.map((ext) => `.${ext}`).join(",")}
          beforeUpload={(_file, list) => {
            // Called once per file with the whole list; act on the first call.
            if (_file === list[0]) void upload(list);
            return false;
          }}
          className="nx-kn-drop"
          data-testid="documents-drop"
        >
          <div className="nx-kn-drop-inner">
            <span className="nx-kn-drop-icon">
              <NxIcon name="import" />
            </span>
            <div>
              <Text strong>Drop files here, or click to choose</Text>
              <div>
                <Text type="secondary">
                  PDF, Word, PowerPoint, Excel, HTML, Markdown and text — read with page numbers kept.
                </Text>
              </div>
            </div>
          </div>
        </Upload.Dragger>
      )}

      {uploads.map((item) => (
        <div className="nx-kn-upload" key={item.name} data-testid="documents-uploading">
          <Text ellipsis>{item.name}</Text>
          {item.error ? (
            <Text type="danger">{item.error}</Text>
          ) : (
            <Progress percent={Math.round(item.fraction * 100)} size="small" />
          )}
        </div>
      ))}

      {collection.documents.length === 0 && !uploads.length ? (
        <EmptyState
          title="No documents yet"
          hint={
            collection.can_edit
              ? "Add the files people ask about — policies, contracts, manuals. Answers will cite them by page."
              : "The owner has not added any files to this collection yet."
          }
        />
      ) : (
        <ul className="nx-kn-doclist">
          {collection.documents.map((document) => (
            <li key={document.id} className="nx-kn-doc" data-testid="document-row" data-status={document.status}>
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
                    document.pages ? `${document.pages} pages` : null,
                    document.status === "READY" ? `${document.chunk_count} passages` : null,
                    document.ingested_at ? `read ${relativeTime(document.ingested_at)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
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
                    Nothing has worked on this for a while. Reprocess it.
                  </Text>
                )}
              </div>
              <StatusTag
                status={document.status}
                label={STATUS_LABEL[document.status]}
                tone={STATUS_TONE[document.status]}
                data-testid="document-status"
              />
              <div className="nx-kn-doc-actions">
                <Tooltip title="Preview">
                  <Button
                    type="text"
                    shape="circle"
                    size="small"
                    icon={<EyeOutlined />}
                    aria-label={`Preview ${document.file.name}`}
                    disabled={!document.file.id}
                    onClick={() => onPreview(document)}
                  />
                </Tooltip>
                {collection.can_edit && !isReading(document) && (
                  <Tooltip title="Read it again">
                    <Button
                      type="text"
                      shape="circle"
                      size="small"
                      icon={<ReloadOutlined />}
                      aria-label={`Reprocess ${document.file.name}`}
                      loading={reprocess.isPending && reprocess.variables?.id === document.id}
                      onClick={() => reprocess.mutate(document)}
                    />
                  </Tooltip>
                )}
                {collection.can_edit && (
                  <Popconfirm
                    title="Take this file out of the collection?"
                    description="The file itself stays in Files."
                    okText="Remove"
                    onConfirm={() => remove.mutate(document)}
                  >
                    <Button
                      type="text"
                      shape="circle"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={`Remove ${document.file.name}`}
                    />
                  </Popconfirm>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}
