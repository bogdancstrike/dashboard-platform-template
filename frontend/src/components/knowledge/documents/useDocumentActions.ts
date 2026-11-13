import { useMutation } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useState } from "react";

import { filesApi } from "@/api/files";
import { knowledgeApi, type CollectionDetail, type KnowledgeDocument } from "@/api/knowledge";

import { useRefreshCollection } from "./uploads";

/** What can be done to a document already in the collection: read it again, remove it, rename its file. */
export function useDocumentActions(collection: CollectionDetail) {
  const { message } = AntApp.useApp();
  const refresh = useRefreshCollection(collection.id);
  const [renaming, setRenaming] = useState<KnowledgeDocument | null>(null);
  const reprocess = useMutation({
    mutationFn: (document: KnowledgeDocument) => knowledgeApi.reprocess(collection.id, document.id),
    onSuccess: () => {
      message.success("Reading it again");
      refresh();
    },
    onError: (error: Error) => message.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (document: KnowledgeDocument) =>
      knowledgeApi.removeDocument(collection.id, document.id),
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
  return { reprocess, remove, rename, renaming, setRenaming };
}
