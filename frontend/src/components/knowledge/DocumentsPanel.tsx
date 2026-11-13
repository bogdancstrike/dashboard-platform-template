import { useMemo, useState } from "react";
import { Input, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";

import type { CollectionDetail, KnowledgeDocument } from "@/api/knowledge";
import { EmptyState } from "@/components/EmptyState";
import { NameModal } from "@/components/NameModal";

import { DocumentRow } from "./documents/DocumentRow";
import { DropZone } from "./documents/DropZone";
import { DEFAULT_MAX_BYTES, useUploadTray } from "./documents/uploads";
import { UploadTray } from "./documents/UploadTray";
import { useDocumentActions } from "./documents/useDocumentActions";

const { Text } = Typography;

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
  const [term, setTerm] = useState("");
  const { tray, accept, send, dismiss } = useUploadTray(collection, supported, maxBytes);
  const { reprocess, remove, rename, renaming, setRenaming } = useDocumentActions(collection);

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
        <DropZone supported={supported} maxBytes={maxBytes} empty={empty} onFiles={accept} />
      )}

      {tray.length > 0 && (
        <UploadTray tray={tray} onRetry={(item) => void send(item)} onDismiss={dismiss} />
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
