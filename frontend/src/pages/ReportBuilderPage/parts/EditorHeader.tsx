import { Button, Tag, Tooltip } from "antd";
import {
  CopyOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  SaveOutlined,
  SettingOutlined,
} from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";
import { relativeTime } from "@/lib/time";
import { COPY_MEANS, confirmCopy } from "@/lib/confirm";

import type { ReadyBuilder } from "../useReportBuilder";

/** The document's name, its state, and save, export, copy and settings. */
export function EditorHeader({ view }: { view: ReadyBuilder }) {
  const {
    modal,
    openId,
    setSettingsOpen,
    stored,
    back,
    open,
    save,
    duplicate,
    exporting,
    canCreate,
    canEdit,
    blocks,
    page,
    dirty,
  } = view;
  return (
    <PageHeader
      title={stored?.name ?? "Document"}
      onBack={() => back(() => open(""))}
      subtitle={[
        stored?.owner.name,
        `${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}`,
        page.size,
        page.orientation,
        stored?.updated_at ? relativeTime(stored.updated_at) : "",
      ]
        .filter(Boolean)
        .join(" · ")}
      tag={dirty ? <Tag color="warning">unsaved</Tag> : undefined}
      actions={
        <>
          {canEdit && (
            <Button
              type={dirty ? "primary" : "default"}
              icon={<SaveOutlined />}
              loading={save.isPending}
              disabled={!dirty}
              onClick={() => save.mutate({ page, blocks })}
              data-testid="save-document"
            >
              Save
            </Button>
          )}
          <Tooltip title={dirty ? "Unsaved changes are not in the file — save first" : ""}>
            <Button
              icon={<FilePdfOutlined />}
              loading={exporting.isPending}
              onClick={() => exporting.mutate("pdf")}
              data-testid="export-pdf"
            >
              PDF
            </Button>
          </Tooltip>
          <Button
            icon={<FileWordOutlined />}
            loading={exporting.isPending}
            onClick={() => exporting.mutate("docx")}
            data-testid="export-docx"
          >
            Word
          </Button>
          {canEdit && (
            <Button
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
              data-testid="document-settings"
            >
              Settings
            </Button>
          )}
          {!canEdit && canCreate && (
            <Button
              icon={<CopyOutlined />}
              loading={duplicate.isPending}
              onClick={() =>
                confirmCopy(modal, {
                  what: stored?.name ?? "this document",
                  consequence:
                    "Every block keeps naming the same saved reports and datasets, so the copy answers with today's data too. " +
                    COPY_MEANS,
                  onOk: () => duplicate.mutateAsync(openId),
                })
              }
              data-testid="copy-document"
            >
              Make a copy
            </Button>
          )}
        </>
      }
    />
  );
}
