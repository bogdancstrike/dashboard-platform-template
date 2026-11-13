import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import { exportsApi } from "@/api/exports";
import { usePageCommands } from "@/commands/CommandContext";
import { queryKeys } from "@/lib/queryKeys";

import { WHILE_WORKING_MS, working } from "./exportCopy";
import { useExportMutations } from "./useExportMutations";

/** The exports, the open one and the filter in the address, the new-export choices, and what is done to a row. */
export function useExportsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [composing, setComposing] = useState(false);
  const [dataset, setDataset] = useState<string>("");
  const [format, setFormat] = useState<string>("csv");

  const opened = params.get("export") ?? "";
  const status = params.get("status") ?? "";
  const openExport = (id: string) =>
    setParams((next) => {
      const merged = new URLSearchParams(next);
      merged.set("export", id);
      return merged;
    });
  const closeExport = () =>
    setParams((next) => {
      const merged = new URLSearchParams(next);
      merged.delete("export");
      return merged;
    });

  const catalogue = useQuery({
    queryKey: queryKeys.exports("catalogue"),
    queryFn: ({ signal }) => exportsApi.catalogue(signal),
  });

  const listing = useQuery({
    queryKey: queryKeys.exports("list", status),
    queryFn: ({ signal }) =>
      exportsApi.list({ ...(status ? { status } : {}), page_size: 50 }, signal),
    // Only while something is actually being produced. A page that polls a
    // finished list is a page making a request per two seconds forever.
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some(working) ? WHILE_WORKING_MS : false,
  });

  const rows = listing.data?.items ?? [];
  const detail = rows.find((row) => row.id === opened);

  // Chosen from what the server offered rather than defaulted here: a hardcoded
  // "ticket" is a dataset some roles cannot read.
  useEffect(() => {
    if (!dataset && catalogue.data?.datasets.length) {
      setDataset(catalogue.data.datasets[0]!.key);
    }
  }, [catalogue.data, dataset]);

  const request = useMemo(
    () => ({ resource_type: dataset, format }),
    [dataset, format],
  );

  const estimate = useQuery({
    queryKey: queryKeys.exports("estimate", dataset, format),
    queryFn: ({ signal }) => exportsApi.estimate(request, signal),
    // Nothing to count until a dataset is chosen, and nothing worth counting
    // while the drawer is shut.
    enabled: composing && Boolean(dataset),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.exports() });
  };

  const { queued, asked, discarded, fetched } = useExportMutations({
    request,
    opened,
    refresh,
    onQueued: () => setComposing(false),
    openExport,
    closeExport,
  });

  usePageCommands("exports", [
    { id: "exports.new", label: "Export a dataset", keywords: "export download csv xlsx json extract", run: () => setComposing(true) },
    { id: "exports.ready", label: "Show the exports that are ready", keywords: "export finished ready download", run: () => setParams(new URLSearchParams({ status: "SUCCEEDED" })) },
    { id: "exports.failed", label: "Show the exports that failed", keywords: "export failed error problem broken", run: () => setParams(new URLSearchParams({ status: "FAILED" })) },
    { id: "exports.all", label: "Show every export", keywords: "export all clear filter everything mine", run: () => setParams(new URLSearchParams()) },
    { id: "exports.import", label: "Bring data in instead", keywords: "import csv upload spreadsheet load", run: () => navigate("/import") },
  ]);

  const chooseStatus = (value: string) =>
    setParams((next) => {
      const merged = new URLSearchParams(next);
      if (value === "all") merged.delete("status");
      else merged.set("status", value);
      return merged;
    });

  return {
    chooseStatus, params, setParams, composing, setComposing, dataset, setDataset, format, setFormat, opened, status,
    catalogue, listing, rows, detail, estimate, refresh, queued, asked, discarded, fetched, openExport, closeExport,
  };
}
