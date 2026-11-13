/** Every write the report builder makes: create, compose, save, copy, export. */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import type { MutableRefObject } from "react";

import { ApiError } from "@/api/client";
import { reportDocumentsApi } from "@/api/reportDocuments";
import type { Capturable } from "@/components/documents/DocumentBlocks";
import { PAPER } from "@/theme/tokens";
import { queryKeys } from "@/lib/queryKeys";

/** The builder's mutations; each keeps the document cache and the list in step. */
export function useDocumentWrites({
  openId,
  open,
  charts,
  setComposeOpen,
  setSettingsOpen,
}: {
  openId: string;
  open: (id: string) => void;
  /** The drawn charts, by block id, asked for their PNGs at export. */
  charts: MutableRefObject<Map<string, Capturable>>;
  setComposeOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : "That change was not saved.");

  const create = useMutation({
    mutationFn: () => reportDocumentsApi.create({ name: "Untitled report" }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.reportDocument(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reportDocuments() });
      open(saved.id);
    },
    onError: failed,
  });

  /**
   * A whole document, composed from what a dataset declares about itself.
   *
   * The blank page is the honest starting point and it is still a blank page:
   * the block menu names nine kinds, and knowing which of them answers "how is
   * this quarter going" is exactly the knowledge somebody opening this screen
   * does not have yet. So the server reads the dataset's own declared
   * insights, groupings and columns and writes the report a person would have
   * written from them — and every block it makes is an ordinary block, editable
   * and removable, so this is a first draft rather than a black box.
   */
  const compose = useMutation({
    mutationFn: (input: { entity: string; period?: string }) => reportDocumentsApi.compose(input),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.reportDocument(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reportDocuments() });
      setComposeOpen(false);
      open(saved.id);
      message.success(`Composed ${saved.name} — edit anything in it.`);
    },
    onError: failed,
  });

  const save = useMutation({
    mutationFn: (input: Parameters<typeof reportDocumentsApi.update>[1]) =>
      reportDocumentsApi.update(openId, input),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.reportDocument(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reportDocuments() });
      setSettingsOpen(false);
      message.success("Saved");
    },
    onError: failed,
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => reportDocumentsApi.duplicate(id),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.reportDocument(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reportDocuments() });
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

  return { create, compose, save, duplicate, exporting };
}
