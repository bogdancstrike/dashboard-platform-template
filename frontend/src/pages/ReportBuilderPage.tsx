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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CopyOutlined,
  DeleteOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  PlusOutlined,
  SaveOutlined,
  SettingOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { explorerApi } from "@/api/explorer";
import { reportsApi } from "@/api/reports";
import {
  reportDocumentsApi,
  type BlockKind,
  type DocumentBlock,
  type DocumentPage,
  type ReportDocument,
} from "@/api/reportDocuments";
import { PageHeader } from "@/components/PageHeader";
import { BLOCK_SPECS, BLOCK_ORDER, newBlock } from "@/components/documents/blocks";
import { BlockPreview, type Capturable } from "@/components/documents/DocumentBlocks";
import { usePageCommands } from "@/commands/CommandContext";
import { relativeTime } from "@/lib/time";
import { PAPER } from "@/theme/tokens";
import { COPY_MEANS, confirmCopy } from "@/lib/confirm";
import { EmptyState } from "@/components/EmptyState";

const { Text, Title, Paragraph } = Typography;

export default function ReportBuilderPage() {
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [params, setParams] = useSearchParams();

  const openId = params.get("doc") ?? "";
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ page: DocumentPage; blocks: DocumentBlock[] } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * The chart instances currently on screen, by block id.
   *
   * A ref, not state: the register changes whenever a chart mounts, and
   * rendering from it would redraw the document every time one of its own
   * charts finished drawing.
   */
  const charts = useRef<Map<string, Capturable>>(new Map());
  const registerChart = useCallback((id: string, chart: Capturable) => {
    if (chart) charts.current.set(id, chart);
    else charts.current.delete(id);
  }, []);

  const listing = useQuery({
    queryKey: ["report-documents"],
    queryFn: ({ signal }) => reportDocumentsApi.list(signal),
  });

  const document = useQuery({
    queryKey: ["report-document", openId],
    queryFn: ({ signal }) => reportDocumentsApi.get(openId, signal),
    enabled: Boolean(openId),
  });

  const resources = useQuery({
    queryKey: ["explorer-catalogue"],
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: 300_000,
  });

  const savedReports = useQuery({
    queryKey: ["reports"],
    queryFn: ({ signal }) => reportsApi.list(signal),
    staleTime: 300_000,
  });

  // The server's answer is the starting point for the draft, and replaces it
  // whenever a *different* document is opened or a save comes back. Held
  // locally in between so typing in a paragraph does not cost a round trip.
  const stored = document.data;
  const storedAt = stored?.updated_at ?? "";
  useEffect(() => {
    if (!stored) return;
    setDraft({ page: stored.page, blocks: stored.blocks ?? [] });
    setSelected(null);
    charts.current.clear();
  }, [stored?.id, storedAt]);

  const open = (id: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set("doc", id);
        else next.delete("doc");
        return next;
      },
      { replace: true },
    );

  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : "That change was not saved.");

  const create = useMutation({
    mutationFn: () => reportDocumentsApi.create({ name: "Untitled report" }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["report-document", saved.id], saved);
      void queryClient.invalidateQueries({ queryKey: ["report-documents"] });
      open(saved.id);
    },
    onError: failed,
  });

  const save = useMutation({
    mutationFn: (input: Parameters<typeof reportDocumentsApi.update>[1]) =>
      reportDocumentsApi.update(openId, input),
    onSuccess: (saved) => {
      queryClient.setQueryData(["report-document", saved.id], saved);
      void queryClient.invalidateQueries({ queryKey: ["report-documents"] });
      setSettingsOpen(false);
      message.success("Saved");
    },
    onError: failed,
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => reportDocumentsApi.duplicate(id),
    onSuccess: (saved) => {
      queryClient.setQueryData(["report-document", saved.id], saved);
      void queryClient.invalidateQueries({ queryKey: ["report-documents"] });
      open(saved.id);
      message.success(`Copied as ${saved.name}`);
    },
    onError: failed,
  });

  /**
   * The export.
   *
   * Every chart on screen is asked for its own PNG first. A chart that is not
   * mounted — a block scrolled out of a virtualised list, one that failed to
   * load — simply is not in the map, and the server renders that block's
   * numbers as a table instead. That is the honest degradation: the numbers
   * are the point, the picture was the presentation of them.
   */
  const exporting = useMutation({
    mutationFn: async (format: "pdf" | "docx") => {
      const images: Record<string, string> = {};
      for (const [id, chart] of charts.current) {
        if (!chart) continue;
        try {
          images[id] = chart.getDataURL({
            type: "png",
            // Twice the screen resolution, on paper white: a chart drawn on
            // the reader's dark surface and dropped into a white page is a
            // black rectangle with a legend in it.
            pixelRatio: 2,
            backgroundColor: PAPER,
          });
        } catch {
          // A canvas the browser refuses to read is one block that renders as
          // a table, not a failed export.
        }
      }
      await reportDocumentsApi.render(openId, { format, images });
    },
    onSuccess: () => message.success("Exported"),
    onError: failed,
  });

  const documents = listing.data?.items ?? [];
  const canCreate = listing.data?.can_create ?? false;
  const canEdit = stored?.can_edit ?? false;
  const blocks = draft?.blocks ?? [];
  const page = draft?.page ?? listing.data?.defaults;

  /** Whether the draft differs from what the server last confirmed. */
  const dirty =
    Boolean(stored && draft) &&
    (JSON.stringify(draft?.blocks) !== JSON.stringify(stored?.blocks ?? []) ||
      JSON.stringify(draft?.page) !== JSON.stringify(stored?.page));

  const change = (next: Partial<{ page: DocumentPage; blocks: DocumentBlock[] }>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));

  const editBlock = (id: string, patch: Partial<DocumentBlock>) =>
    change({
      blocks: blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
    });

  const addBlock = (kind: BlockKind) => {
    const block = newBlock(kind, blocks);
    change({ blocks: [...blocks, block] });
    setSelected(block.id);
  };

  const moveBlock = (id: string, by: number) => {
    const index = blocks.findIndex((block) => block.id === id);
    const target = index + by;
    if (index < 0 || target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    change({ blocks: next });
  };

  const dropBlock = (id: string) => {
    charts.current.delete(id);
    change({ blocks: blocks.filter((block) => block.id !== id) });
    setSelected((current) => (current === id ? null : current));
  };

  usePageCommands("report-builder", [
    {
      id: "documents.new",
      label: "Compose a report document",
      keywords: "new report pdf docx document",
      run: () => create.mutate(),
    },
    {
      id: "documents.pdf",
      label: "Export this document as a PDF",
      keywords: "export pdf download",
      run: () => exporting.mutate("pdf"),
    },
  ]);

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
            </Tooltip>
          }
        />
        {documents.length === 0 ? (
          <Card size="small">
            <EmptyState compact title="No documents yet. One starts as a heading and a paragraph." action={<>{canCreate && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => create.mutate()}>
                  New document
                </Button>
              )}</>} />
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
                      "Every block keeps naming the same saved reports and datasets, so the copy answers with today's data too. " + COPY_MEANS,
                    onOk: () => duplicate.mutateAsync(item.id),
                  })
                }
              />
            ))}
          </div>
        )}
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
        action={
          <Button onClick={() => open("")}>
            All documents
          </Button>
        }
      />
    );
  }

  const chosen = blocks.find((block) => block.id === selected) ?? null;

  // ── the composer ───────────────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title={stored?.name ?? "Document"}
        onBack={() => open("")}
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
            <Tooltip
              title={dirty ? "Unsaved changes are not in the file — save first" : ""}
            >
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
                      "Every block keeps naming the same saved reports and datasets, so the copy answers with today's data too. " + COPY_MEANS,
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
        {/* What the document is made of, in order. Deliberately a list rather
            than the page itself: a twelve-block document is a page somebody
            scrolls, and reordering by dragging paragraphs around a preview is
            a gesture nobody can aim. */}
        <aside className="nu-doc-outline" aria-label="Blocks">
          <div className="nu-doc-outline-head">
            <Text strong>Blocks</Text>
            {canEdit && (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: BLOCK_ORDER.map((kind) => ({
                    key: kind,
                    icon: BLOCK_SPECS[kind].icon,
                    label: (
                      <span className="nu-doc-additem">
                        <span>{BLOCK_SPECS[kind].label}</span>
                        <span>{BLOCK_SPECS[kind].hint}</span>
                      </span>
                    ),
                  })),
                  onClick: ({ key }) => addBlock(key as BlockKind),
                }}
              >
                <Button type="primary" icon={<PlusOutlined />} data-testid="add-block">
                  Add
                </Button>
              </Dropdown>
            )}
          </div>

          <ol className="nu-doc-outline-list">
            {blocks.map((block, index) => (
              <li key={block.id}>
                <div
                  className={`nu-doc-outline-row${selected === block.id ? " is-chosen" : ""}`}
                  data-testid={`outline-${block.id}`}
                >
                  <button
                    type="button"
                    className="nu-doc-outline-face"
                    onClick={() => setSelected(block.id)}
                  >
                    <span className="nu-doc-outline-icon" aria-hidden>
                      {BLOCK_SPECS[block.kind].icon}
                    </span>
                    <span className="nu-doc-outline-text">
                      <span className="nu-doc-outline-label">
                        {describe(block, savedReports.data?.items ?? [])}
                      </span>
                      <span className="nu-doc-outline-kind">{BLOCK_SPECS[block.kind].label}</span>
                    </span>
                  </button>
                  {canEdit && (
                    <Space size={0}>
                      <Button
                        type="text"
                        aria-label={`Move ${BLOCK_SPECS[block.kind].label} up`}
                        disabled={index === 0}
                        icon={<ArrowUpOutlined />}
                        onClick={() => moveBlock(block.id, -1)}
                      />
                      <Button
                        type="text"
                        aria-label={`Move ${BLOCK_SPECS[block.kind].label} down`}
                        disabled={index === blocks.length - 1}
                        icon={<ArrowDownOutlined />}
                        onClick={() => moveBlock(block.id, 1)}
                      />
                      <Button
                        type="text"
                        danger
                        aria-label={`Remove ${BLOCK_SPECS[block.kind].label}`}
                        icon={<DeleteOutlined />}
                        onClick={() =>
                          modal.confirm({
                            title: `Remove this ${BLOCK_SPECS[block.kind].label.toLowerCase()}?`,
                            content: "It comes off the document. Nothing it pointed at is affected.",
                            okText: "Remove",
                            okButtonProps: { danger: true },
                            onOk: () => dropBlock(block.id),
                          })
                        }
                      />
                    </Space>
                  )}
                </div>
              </li>
            ))}
            {blocks.length === 0 && (
              <Text type="secondary" className="nu-doc-outline-empty">
                Nothing yet. Add a heading to begin.
              </Text>
            )}
          </ol>
        </aside>

        {/* The document. Not an impression of it — the same three endpoints
            the server resolves each block through when it writes the file. */}
        <div className="nu-doc-paper-wrap">
          <article
            className={`nu-doc-paper is-${page.orientation}`}
            data-testid="document-paper"
            style={{ ["--nu-doc-accent" as string]: page.accent }}
          >
            {page.header && <div className="nu-doc-runhead">{page.header}</div>}
            <div className="nu-doc-body" style={{ padding: `${page.margin_mm}px` }}>
              {page.cover && (
                <header className="nu-doc-cover">
                  <Title level={1} className="nu-doc-cover-title">
                    {stored?.name}
                  </Title>
                  {page.subtitle && (
                    <Paragraph className="nu-doc-cover-sub">{page.subtitle}</Paragraph>
                  )}
                  <div className="nu-doc-break" aria-label="Page break">
                    <span>page break</span>
                  </div>
                </header>
              )}
              {blocks.map((block) => (
                <section
                  key={block.id}
                  className={`nu-doc-block${selected === block.id ? " is-chosen" : ""}`}
                  onClick={() => setSelected(block.id)}
                  data-testid={`block-${block.id}`}
                >
                  <BlockPreview
                    block={block}
                    resources={resources.data?.items ?? []}
                    onChart={registerChart}
                  />
                </section>
              ))}
              {blocks.length === 0 && (
                <EmptyState compact title="An empty document. Add a block from the left." />
              )}
            </div>
            {(page.footer || page.page_numbers) && (
              <div className="nu-doc-runfoot">
                <span>{page.footer}</span>
                {page.page_numbers && <span>1</span>}
              </div>
            )}
          </article>
        </div>

        {/* What the selected block shows, or — with nothing selected — the
            paper it is all printed on. One rail, two subjects, because a
            document has exactly those two kinds of setting. */}
        <aside className="nu-doc-inspector" aria-label="Settings">
          {chosen ? (
            <BlockSettings
              block={chosen}
              canEdit={canEdit}
              datasets={listing.data?.datasets ?? []}
              reports={savedReports.data?.items ?? []}
              onChange={(patch) => editBlock(chosen.id, patch)}
              onClose={() => setSelected(null)}
            />
          ) : (
            <PageSettings page={page} canEdit={canEdit} onChange={(next) => change({ page: next })} />
          )}
        </aside>
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

/** What one block is about, in the outline. */
function describe(block: DocumentBlock, reports: { id: string; name: string }[]): string {
  if (block.kind === "HEADING" || block.kind === "TEXT") {
    const text = (block.text ?? "").trim();
    return text ? text.slice(0, 60) : "Empty";
  }
  if (block.kind === "REPORT") {
    return reports.find((report) => report.id === block.report_id)?.name ?? "No report chosen";
  }
  if (block.kind === "TABLE" || block.kind === "METRICS") {
    return block.entity || "No dataset chosen";
  }
  return BLOCK_SPECS[block.kind].hint;
}

/** One document in the gallery. */
function DocumentCard({
  document,
  canCopy,
  onOpen,
  onCopy,
}: {
  document: ReportDocument;
  canCopy: boolean;
  onOpen: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="nu-board-card" onClick={onOpen} data-testid={`document-card-${document.id}`}>
      <div className="nu-board-head">
        <Space size={6} className="nu-board-title">
          <button type="button" className="nu-board-open" onClick={onOpen}>
            <Text strong ellipsis>
              {document.name}
            </Text>
          </button>
        </Space>
        <Space size={0} onClick={(event) => event.stopPropagation()}>
          {!document.can_edit && canCopy && (
            <Tooltip title="Make a copy you can change">
              <Button
                type="text"
                aria-label={`Make a copy of ${document.name}`}
                icon={<CopyOutlined />}
                onClick={onCopy}
              />
            </Tooltip>
          )}
        </Space>
      </div>
      <Paragraph type="secondary" className="nu-board-desc" ellipsis={{ rows: 2 }}>
        {document.description ||
          `${document.block_count} ${document.block_count === 1 ? "block" : "blocks"} · ${document.page.size} ${document.page.orientation}`}
      </Paragraph>
      <div className="nu-board-kinds">
        {document.block_kinds.slice(0, 5).map((kind) => (
          <Tag key={kind} bordered={false}>
            {BLOCK_SPECS[kind].label}
          </Tag>
        ))}
        {document.block_kinds.length === 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Nothing on it yet
          </Text>
        )}
      </div>
      <div className="nu-board-foot">
        <Text type="secondary">{relativeTime(document.updated_at)}</Text>
        <Space size={6}>
          {document.render_count > 0 && (
            <Tag bordered={false}>
              exported {document.render_count === 1 ? "once" : `${document.render_count} times`}
            </Tag>
          )}
          {!document.can_edit && (
            <Tag bordered={false} icon={<ShareAltOutlined />}>
              {document.owner.name}
            </Tag>
          )}
        </Space>
      </div>
    </div>
  );
}

/** The paper, and the furniture printed on every page of it. */
function PageSettings({
  page,
  canEdit,
  onChange,
}: {
  page: DocumentPage;
  canEdit: boolean;
  onChange: (next: DocumentPage) => void;
}) {
  const set = (patch: Partial<DocumentPage>) => onChange({ ...page, ...patch });
  return (
    <div className="nu-doc-panel">
      <Text strong>The page</Text>
      <Paragraph type="secondary" className="nu-doc-panel-note">
        Applies to every page of the export. Select a block to change what it shows.
      </Paragraph>
      <Form layout="vertical" size="small" disabled={!canEdit}>
        <Form.Item label="Paper">
          <Segmented
            block
            value={page.size}
            onChange={(value) => set({ size: value as DocumentPage["size"] })}
            options={[
              { value: "A4", label: "A4" },
              { value: "LETTER", label: "Letter" },
            ]}
          />
        </Form.Item>
        <Form.Item label="Orientation">
          <Segmented
            block
            value={page.orientation}
            onChange={(value) => set({ orientation: value as DocumentPage["orientation"] })}
            options={[
              { value: "portrait", label: "Portrait" },
              { value: "landscape", label: "Landscape" },
            ]}
          />
        </Form.Item>
        <Form.Item label="Margin" extra="Millimetres, on every side.">
          <InputNumber
            min={5}
            max={50}
            value={page.margin_mm}
            onChange={(value) => set({ margin_mm: Number(value ?? 20) })}
            style={{ width: "100%" }}
            aria-label="Margin"
          />
        </Form.Item>
        <Form.Item label="Running header" extra="Printed at the top of every page.">
          <Input
            value={page.header}
            onChange={(event) => set({ header: event.target.value })}
            placeholder="Acme · Confidential"
          />
        </Form.Item>
        <Form.Item label="Footer" extra="Printed at the bottom of every page.">
          <Input
            value={page.footer}
            onChange={(event) => set({ footer: event.target.value })}
            placeholder="Prepared for the board"
          />
        </Form.Item>
        <Form.Item label="Number the pages" valuePropName="checked">
          <Switch
            checked={page.page_numbers}
            onChange={(value) => set({ page_numbers: value })}
            aria-label="Number the pages"
          />
        </Form.Item>
        <Form.Item label="Title page" valuePropName="checked" extra="A cover, then a page break.">
          <Switch
            checked={page.cover}
            onChange={(value) => set({ cover: value })}
            aria-label="Title page"
          />
        </Form.Item>
        {page.cover && (
          <Form.Item label="Subtitle">
            <Input
              value={page.subtitle}
              onChange={(event) => set({ subtitle: event.target.value })}
              placeholder="Q3 · prepared 12 October"
            />
          </Form.Item>
        )}
        <Form.Item label="Accent" extra="Headings and table headers in the export.">
          <Input
            type="color"
            value={page.accent}
            onChange={(event) => set({ accent: event.target.value })}
            aria-label="Accent"
          />
        </Form.Item>
      </Form>
    </div>
  );
}

/** What one block shows. The kind decides which controls appear. */
function BlockSettings({
  block,
  canEdit,
  datasets,
  reports,
  onChange,
  onClose,
}: {
  block: DocumentBlock;
  canEdit: boolean;
  datasets: { key: string; label: string }[];
  reports: { id: string; name: string; visualization: string }[];
  onChange: (patch: Partial<DocumentBlock>) => void;
  onClose: () => void;
}) {
  const spec = BLOCK_SPECS[block.kind];
  return (
    <div className="nu-doc-panel">
      <div className="nu-doc-panel-head">
        <Text strong>{spec.label}</Text>
        <Button type="text" onClick={onClose}>
          The page
        </Button>
      </div>
      <Paragraph type="secondary" className="nu-doc-panel-note">
        {spec.hint}
      </Paragraph>

      <Form layout="vertical" size="small" disabled={!canEdit}>
        {block.kind === "HEADING" && (
          <>
            <Form.Item label="Text">
              <Input
                value={block.text}
                autoFocus
                onChange={(event) => onChange({ text: event.target.value })}
                aria-label="Heading text"
              />
            </Form.Item>
            <Form.Item label="Level">
              <Segmented
                block
                value={block.level ?? 2}
                onChange={(value) => onChange({ level: Number(value) })}
                options={[
                  { value: 1, label: "Title" },
                  { value: 2, label: "Section" },
                  { value: 3, label: "Sub" },
                ]}
              />
            </Form.Item>
          </>
        )}

        {block.kind === "TEXT" && (
          <Form.Item label="Paragraph" extra="A blank line starts a new paragraph.">
            <Input.TextArea
              rows={8}
              value={block.text}
              onChange={(event) => onChange({ text: event.target.value })}
              aria-label="Paragraph"
            />
          </Form.Item>
        )}

        {block.kind === "SPACER" && (
          <Form.Item label="How much room">
            <Segmented
              block
              value={block.size ?? "medium"}
              onChange={(value) => onChange({ size: String(value) })}
              options={[
                { value: "small", label: "Small" },
                { value: "medium", label: "Medium" },
                { value: "large", label: "Large" },
              ]}
            />
          </Form.Item>
        )}

        {block.kind === "REPORT" && (
          <>
            <Form.Item
              label="Which report"
              extra="Run when the file is written, so the document is never stale."
            >
              <Select
                value={block.report_id}
                onChange={(value) => onChange({ report_id: value })}
                aria-label="Report"
                showSearch
                optionFilterProp="label"
                options={reports.map((report) => ({
                  value: report.id,
                  label: `${report.name} · ${report.visualization}`,
                }))}
                notFoundContent="You have not saved a report yet"
              />
            </Form.Item>
            {reports.length === 0 && (
              // Offered with the way out rather than left as an empty select:
              // the chart builder is where a picture is composed, and this is
              // the one moment somebody needs to be told that (§76).
              <Alert
                type="info"
                showIcon
                className="nu-block"
                message="No saved reports yet"
                description={
                  <>
                    A chart on a page is one you built in the{" "}
                    <Link to="/charts/builder">chart builder</Link> and saved. Build one, then
                    come back — this block will draw it with today&apos;s data every time the
                    file is written.
                  </>
                }
              />
            )}
            <Form.Item label="Show" extra="The picture, its numbers, or both.">
              <Segmented
                block
                value={block.show ?? "both"}
                onChange={(value) => onChange({ show: value as DocumentBlock["show"] })}
                options={[
                  { value: "chart", label: "Chart" },
                  { value: "table", label: "Table" },
                  { value: "both", label: "Both" },
                ]}
              />
            </Form.Item>
          </>
        )}

        {(block.kind === "TABLE" || block.kind === "METRICS") && (
          <Form.Item label="Dataset">
            <Select
              value={block.entity}
              onChange={(value) => onChange({ entity: value })}
              aria-label="Dataset"
              showSearch
              optionFilterProp="label"
              options={datasets.map((item) => ({ value: item.key, label: item.label }))}
            />
          </Form.Item>
        )}

        {block.kind === "TABLE" && (
          <>
            <Form.Item label="Sort by" extra="Leave empty for the dataset's own order.">
              <Input
                value={block.sort}
                onChange={(event) => onChange({ sort: event.target.value })}
                placeholder="updated_at"
                aria-label="Sort by"
              />
            </Form.Item>
            <Form.Item label="Direction">
              <Segmented
                block
                value={block.order ?? "desc"}
                onChange={(value) => onChange({ order: value as "asc" | "desc" })}
                options={[
                  { value: "desc", label: "Newest first" },
                  { value: "asc", label: "Oldest first" },
                ]}
              />
            </Form.Item>
            <Form.Item label="How many rows" extra="Up to 200. Past that, use an export (§30).">
              <InputNumber
                min={1}
                max={200}
                value={block.limit ?? 20}
                onChange={(value) => onChange({ limit: Number(value ?? 20) })}
                style={{ width: "100%" }}
                aria-label="How many rows"
              />
            </Form.Item>
          </>
        )}

        {block.kind !== "HEADING" &&
          block.kind !== "TEXT" &&
          block.kind !== "SPACER" &&
          block.kind !== "DIVIDER" &&
          block.kind !== "PAGE_BREAK" && (
            <Form.Item label="Caption" extra="A line above it, naming what it shows.">
              <Input
                value={block.caption}
                onChange={(event) => onChange({ caption: event.target.value })}
                aria-label="Caption"
              />
            </Form.Item>
          )}
      </Form>
    </div>
  );
}

/** The document itself: its name and what it is for. */
function SettingsDialog({
  open,
  document,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  document: ReportDocument | undefined;
  saving: boolean;
  onClose: () => void;
  onSave: (input: { name: string; description: string | null }) => void;
}) {
  const [form] = Form.useForm();
  if (!document) return null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      destroyOnHidden
      title={`Settings — ${document.name}`}
      okText="Save"
      confirmLoading={saving}
      onOk={() => void form.submit()}
      okButtonProps={{ "data-testid": "save-settings" }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ name: document.name, description: document.description ?? "" }}
        onFinish={(values: { name: string; description?: string }) =>
          onSave({ name: values.name, description: values.description || null })
        }
      >
        <Form.Item
          name="name"
          label="Name"
          extra="Also the title on the cover and the name of the file."
          rules={[{ required: true, message: "Give it a name" }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="description" label="What it is for">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
