/**
 * `/reports/builder` — composing a *document*, not a chart (§28).
 *
 * This page and `/charts/builder` used to be the same screen with two names:
 * both picked a dataset, a grouping and a picture, and both saved a
 * `SavedReport`. One of them was redundant, and it was this one.
 *
 * **A report is a question. A document is a page.** The chart builder still
 * owns the question — dataset, grouping, measure, which picture — and it is
 * excellent at it. What nothing owned was the thing people actually mean by
 * "customise a report": a title page, headings, paragraphs they wrote, several
 * answers arranged between them, a running header, a footer, a page number,
 * and a file they can send. There was nowhere in the analysis stack to put a
 * footer, which is why the two builders converged.
 *
 * So: this composes a document out of blocks, and exports it as a real PDF or
 * a real DOCX.
 *
 * Four decisions worth stating.
 *
 * **A block names a question; it does not restate one.** A report block
 * carries a report id and runs the stored definition through the same compiler
 * the chart builder previewed with. Nothing is cached, so the same document
 * exported in March and in June is one layout over two months of data — which
 * is what "the monthly report" means.
 *
 * **What you see is what you export.** The middle column is not an impression
 * of the document; it is the document, drawn by the same three endpoints the
 * server resolves each block through when it writes the file.
 *
 * **The charts are captured here.** There is no chart engine on the server and
 * adding one would be a second implementation of every picture in the product.
 * Each chart registers itself by block id, and Export asks it for a PNG — so
 * the file carries the picture that was on screen. A chart that could not be
 * captured falls back to its own numbers as a table rather than to a blank
 * space.
 *
 * **The paper is a first-class setting.** Size, orientation, margins, header,
 * footer, page numbers and a cover all live on the document, because that is
 * the half of "a report" that a question cannot express.
 */

import { Alert, Button, Card, Skeleton, Space, Tooltip, Typography } from "antd";
import { PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";

import { ApiError } from "@/api/client";
import { PageHeader } from "@/components/PageHeader";
import { COPY_MEANS, confirmCopy } from "@/lib/confirm";
import { EmptyState } from "@/components/EmptyState";

import { ComposeDialog } from "./parts/ComposeDialog";
import { DocumentCard } from "./parts/DocumentCard";
import { SettingsDialog } from "./parts/SettingsDialog";
import { BlockOutline } from "./parts/BlockOutline";
import { DocumentPaper } from "./parts/DocumentPaper";
import { EditorHeader } from "./parts/EditorHeader";
import { Inspector } from "./parts/Inspector";
import { useReportBuilder } from "./useReportBuilder";

const { Text } = Typography;

export default function ReportBuilderPage() {
  const view = useReportBuilder();
  const {
    modal,
    openId,
    draft,
    settingsOpen,
    setSettingsOpen,
    composeOpen,
    setComposeOpen,
    listing,
    document,
    catalogue,
    stored,
    open,
    create,
    compose,
    save,
    duplicate,
    documents,
    canCreate,
    canEdit,
    page,
  } = view;
  if (listing.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (listing.isError) {
    const api = listing.error instanceof ApiError ? listing.error : null;
    return (
      <>
        <PageHeader title="Report documents" />
        <Alert
          type={api?.isForbidden ? "warning" : "error"}
          showIcon
          message={api?.message ?? "Your documents could not be loaded"}
          description={
            api ? (
              <Text code copyable={{ text: api.correlationId }}>
                {api.correlationId}
              </Text>
            ) : undefined
          }
        />
      </>
    );
  }

  // ── the gallery ────────────────────────────────────────────────────────
  if (!openId) {
    return (
      <>
        <PageHeader
          title="Report documents"
          subtitle="A page you compose — a cover, your words, and the answers to several questions between them. Exported as a PDF or a Word file."
          actions={
            <Tooltip title={canCreate ? "" : "Your role does not include reports.manage"}>
              <Space>
                <Button
                  icon={<ThunderboltOutlined />}
                  disabled={!canCreate}
                  onClick={() => setComposeOpen(true)}
                  data-testid="compose-document"
                >
                  Compose one for me
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  disabled={!canCreate}
                  loading={create.isPending}
                  onClick={() => create.mutate()}
                  data-testid="new-document"
                >
                  New document
                </Button>
              </Space>
            </Tooltip>
          }
        />
        {documents.length === 0 ? (
          <Card size="small">
            <EmptyState
              compact
              title="No documents yet. One starts as a heading and a paragraph — or have one composed from a dataset."
              action={
                <>
                  {canCreate && (
                    <Space>
                      <Button icon={<ThunderboltOutlined />} onClick={() => setComposeOpen(true)}>
                        Compose one for me
                      </Button>
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => create.mutate()}
                      >
                        New document
                      </Button>
                    </Space>
                  )}
                </>
              }
            />
          </Card>
        ) : (
          <div className="nu-boards" data-testid="document-gallery">
            {documents.map((item) => (
              <DocumentCard
                key={item.id}
                document={item}
                canCopy={canCreate}
                onOpen={() => open(item.id)}
                onCopy={() =>
                  confirmCopy(modal, {
                    what: item.name,
                    consequence:
                      "Every block keeps naming the same saved reports and datasets, so the copy answers with today's data too. " +
                      COPY_MEANS,
                    onOk: () => duplicate.mutateAsync(item.id),
                  })
                }
              />
            ))}
          </div>
        )}
        <ComposeDialog
          open={composeOpen}
          catalogue={catalogue.data}
          composing={compose.isPending}
          onClose={() => setComposeOpen(false)}
          onCompose={(input) => compose.mutate(input)}
        />
      </>
    );
  }

  if (document.isLoading || !draft || !page) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (document.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message={
          document.error instanceof ApiError
            ? document.error.message
            : "That document could not be opened"
        }
        action={<Button onClick={() => open("")}>All documents</Button>}
      />
    );
  }

  const ready = { ...view, page, draft };

  return (
    <>
      <EditorHeader view={ready} />

      {!canEdit && (
        <Alert
          className="nu-block"
          type="info"
          showIcon
          message="This document is read-only for you"
          description={`${stored?.owner.name} owns it. Take a copy to compose your own version — every block keeps pointing at the same saved reports.`}
        />
      )}

      <div className="nu-doc-workspace">
        <BlockOutline view={ready} />

        <DocumentPaper view={ready} />

        <Inspector view={ready} />
      </div>

      <SettingsDialog
        open={settingsOpen}
        document={stored}
        saving={save.isPending}
        onClose={() => setSettingsOpen(false)}
        onSave={(input) => save.mutate(input)}
      />
    </>
  );
}
