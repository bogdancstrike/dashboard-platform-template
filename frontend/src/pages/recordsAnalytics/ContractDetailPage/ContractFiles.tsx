import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Skeleton, Upload } from "antd";
import { useNavigate } from "react-router-dom";

import { filesApi, putBytes } from "@/api/files";
import { contractsApi } from "@/api/recordsAnalytics";
import { FailureAlert } from "@/components/FailureAlert";
import { PanelHeader } from "@/components/layout/PanelHeader";
import { NxIcon } from "@/components/NxIcon";
import { errorText } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";
import { relativeTime } from "@/lib/time";

/** The contract's documents, and attaching one into the contract's own folder. */
export function useContractFiles(id: string) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const files = useQuery({
    queryKey: queryKeys.contract(id, "files"),
    queryFn: ({ signal }) => contractsApi.files(id, signal),
    enabled: Boolean(id),
  });

  const upload = async (file: File) => {
    try {
      const { folder_id } = await contractsApi.folder(id);
      const ticket = await filesApi.beginUpload({ name: file.name, size_bytes: file.size, mime_type: file.type || undefined, folder_id });
      await putBytes(ticket, file, () => undefined);
      await filesApi.confirmUpload(ticket.file.id);
      void message.success(`${file.name} attached.`);
      void client.invalidateQueries({ queryKey: queryKeys.contract(id, "files") });
    } catch (error) {
      void message.error(errorText(error, { action: "upload files" }));
    }
    return false;
  };

  return { files, upload };
}

/** The documents tab: signed copies and order forms, each opening in Files. */
export function ContractFiles({ files, upload }: ReturnType<typeof useContractFiles>) {
  const navigate = useNavigate();
  return (
    <section className="nx-ra-panel" data-testid="contract-files">
      <PanelHeader title="Documents" extra={files.data?.can_upload && (
          <Upload beforeUpload={(file) => upload(file)} showUploadList={false} multiple>
            <Button icon={<NxIcon name="import" />}>Attach</Button>
          </Upload>
        )} />
      {files.isError ? <FailureAlert error={files.error} /> : !files.data ? <Skeleton active /> : files.data.items.length === 0 ? (
        <p className="nx-ra-muted">No documents yet. Signed copies and order forms belong here.</p>
      ) : (
        <ul className="nx-ra-rows">
          {files.data.items.map((file) => (
            <li key={file.id} className="nx-ra-row" onClick={() => navigate(`/files?folder=${files.data.folder_id}&file=${file.id}`)}>
              <NxIcon name="folder" />
              <div className="nx-ra-row-main">
                <b>{file.name}</b>
                <span>{Math.max(1, Math.round(file.size_bytes / 1024))} KB · {file.owner ?? "—"} · {relativeTime(file.created_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
