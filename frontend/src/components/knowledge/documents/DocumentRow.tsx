import { Button, Popconfirm, Tooltip, Typography } from "antd";
import { DeleteOutlined, EditOutlined, EyeOutlined, ReloadOutlined } from "@ant-design/icons";

import { readableSize } from "@/api/files";
import {
  failureText,
  isReading,
  type DocumentStatus,
  type KnowledgeDocument,
} from "@/api/knowledge";
import { StatusTag } from "@/components/StatusTag";
import { relativeTime } from "@/lib/time";

const { Text } = Typography;

/** The reading's stages, in order, as a reader names them. */
const STAGES: { status: DocumentStatus; label: string }[] = [
  { status: "QUEUED", label: "Queued" },
  { status: "PARSING", label: "Reading" },
  { status: "CHUNKING", label: "Splitting" },
  { status: "EMBEDDING", label: "Indexing" },
  { status: "READY", label: "Ready" },
];
const STAGE_INDEX = Object.fromEntries(
  STAGES.map((stage, index) => [stage.status, index]),
) as Record<string, number>;

const TONE: Record<string, "ok" | "warn" | "bad" | "acc" | "neutral"> = {
  QUEUED: "neutral",
  PARSING: "acc",
  CHUNKING: "acc",
  EMBEDDING: "acc",
  READY: "ok",
  FAILED: "bad",
};

export function DocumentRow({
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
              <li
                key={item.status}
                className={index < stage ? "is-done" : index === stage ? "is-now" : ""}
              >
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
        {document.status === "READY" &&
          document.warnings.some((w) => w.startsWith("EMBEDDINGS_UNAVAILABLE")) && (
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
