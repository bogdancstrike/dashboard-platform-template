/** What the page reads, what it keeps in the address, and what it derives. */

import { useQuery } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { analysisApi } from "@/api/analysis";
import { explorerApi } from "@/api/explorer";
import { reportsApi } from "@/api/reports";
import { reportDocumentsApi, type DocumentBlock, type DocumentPage } from "@/api/reportDocuments";
import { useSmartBack } from "@/app/history";
import type { Capturable } from "@/components/documents/DocumentBlocks";
import { usePageCommands } from "@/commands/CommandContext";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { draftEditing } from "./draftEditing";
import { useDocumentWrites } from "./useDocumentWrites";

/** The page's state, queries and actions. */
export function useReportBuilder() {
  const { message, modal } = AntApp.useApp();
  const [params, setParams] = useSearchParams();

  const openId = params.get("doc") ?? "";
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ page: DocumentPage; blocks: DocumentBlock[] } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

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
    queryKey: queryKeys.reportDocuments(),
    queryFn: ({ signal }) => reportDocumentsApi.list(signal),
  });

  const document = useQuery({
    queryKey: queryKeys.reportDocument(openId),
    queryFn: ({ signal }) => reportDocumentsApi.get(openId, signal),
    enabled: Boolean(openId),
  });

  const resources = useQuery({
    queryKey: queryKeys.explorerCatalogue(),
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: STALE.long,
  });

  const savedReports = useQuery({
    queryKey: queryKeys.reports(),
    queryFn: ({ signal }) => reportsApi.list(signal),
    staleTime: STALE.long,
  });

  // What a chart block can be asked — the same catalogue the chart builder and
  // the analytics workspace compose from, so a question posed on a page is a
  // question those screens would also accept.
  const catalogue = useQuery({
    queryKey: queryKeys.analysisCatalogue(),
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: STALE.long,
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

  const back = useSmartBack();
  const open = (id: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set("doc", id);
        else next.delete("doc");
        return next;
      },
      // Pushed: opening a document is a place, so back closes it.
      { replace: false },
    );

  const { create, compose, save, duplicate, exporting } = useDocumentWrites({
    openId,
    open,
    charts,
    setComposeOpen,
    setSettingsOpen,
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

  const { change, editBlock, addBlock, moveBlock, dropBlock } = draftEditing({
    blocks,
    setDraft,
    setSelected,
    charts,
  });

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
    {
      id: "documents.docx",
      label: "Export this document as a Word file",
      keywords: "export docx word download office",
      run: () => exporting.mutate("docx"),
    },
    {
      id: "documents.compose",
      label: "Have a report composed from a dataset",
      keywords: "compose auto generate draft first automatic",
      run: () => setComposeOpen(true),
    },
    {
      id: "documents.chart",
      label: "Add a chart to this document",
      keywords: "chart graph picture block add visual",
      run: () => addBlock("CHART"),
    },
    {
      id: "documents.table",
      label: "Add a table of records",
      keywords: "table rows records block add list",
      run: () => addBlock("TABLE"),
    },
    {
      id: "documents.metrics",
      label: "Add the headline numbers",
      keywords: "metrics numbers statistics figures kpi block",
      run: () => addBlock("METRICS"),
    },
  ]);

  const chosen = blocks.find((block) => block.id === selected) ?? null;

  // ── the composer ───────────────────────────────────────────────────────

  return {
    message,
    modal,
    openId,
    selected,
    setSelected,
    draft,
    settingsOpen,
    setSettingsOpen,
    composeOpen,
    setComposeOpen,
    registerChart,
    listing,
    document,
    resources,
    savedReports,
    catalogue,
    stored,
    back,
    open,
    create,
    compose,
    save,
    duplicate,
    exporting,
    documents,
    canCreate,
    canEdit,
    blocks,
    page,
    dirty,
    change,
    editBlock,
    addBlock,
    moveBlock,
    dropBlock,
    chosen,
  };
}

export type ReportBuilderData = ReturnType<typeof useReportBuilder>;

/** The builder once a document is open and its draft has arrived — what the editor's parts draw. */
export type ReadyBuilder = ReportBuilderData & {
  page: NonNullable<ReportBuilderData["page"]>;
  draft: NonNullable<ReportBuilderData["draft"]>;
};
