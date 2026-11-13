import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import { importsApi } from "@/api/imports";
import { usePageCommands } from "@/commands/CommandContext";
import { queryKeys } from "@/lib/queryKeys";

import { WHILE_RUNNING_MS } from "./importCopy";
import { useRunMutations } from "./useRunMutations";

/** The open run in the address, the local column mapping, and the four things done to a run. */
export function useImportPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [target, setTarget] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const opened = params.get("run") ?? "";

  const catalogue = useQuery({
    queryKey: queryKeys.imports("catalogue"),
    queryFn: ({ signal }) => importsApi.catalogue(signal),
  });

  const listing = useQuery({
    queryKey: queryKeys.imports("list"),
    queryFn: ({ signal }) => importsApi.list({ page_size: 25 }, signal),
  });

  const run = useQuery({
    queryKey: queryKeys.imports("run", opened),
    queryFn: ({ signal }) => importsApi.entry(opened, signal),
    enabled: Boolean(opened),
    // Only while an execute is in flight. A page that polls a finished import
    // is a page making a request every second and a half forever.
    refetchInterval: (query) =>
      query.state.data?.status === "RUNNING" ? WHILE_RUNNING_MS : false,
  });

  const current = run.data;
  // Memoised, or the `?? []` makes a new array every render and every hook
  // depending on it re-runs.
  const targets = useMemo(() => catalogue.data?.targets ?? [], [catalogue.data]);
  const chosen = useMemo(
    () => targets.find((entry) => entry.key === (target || targets[0]?.key)),
    [targets, target],
  );

  // The mapping is edited locally and sent on Check, so a reader can change
  // three columns without three round trips and three re-validations. Keyed on
  // the *server's* mapping, so re-adopting it is what a fresh run or a
  // completed check does — and not what a local edit does, which would
  // otherwise undo the edit as it was made.
  const serverMapping = current?.column_mapping;
  useEffect(() => {
    if (serverMapping) setMapping(serverMapping);
  }, [serverMapping]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.imports() });
  };

  const open = (id: string) =>
    setParams((next) => {
      const merged = new URLSearchParams(next);
      merged.set("run", id);
      return merged;
    });

  const navigate = useNavigate();
  const close = () =>
    setParams((next) => {
      const merged = new URLSearchParams(next);
      merged.delete("run");
      return merged;
    });

  const { begun, mapped, executed, discarded } = useRunMutations({ target: chosen?.key ?? "", opened, mapping, refresh, open, close });

  usePageCommands("import", [
    {
      id: "import.new",
      label: "Import a spreadsheet",
      keywords: "import csv upload spreadsheet load data",
      run: () => close(),
    },
    {
      id: "import.history",
      label: "Show what has been imported before",
      keywords: "history runs past previous imports log",
      run: () => {
        close();
        document
          .querySelector('[data-testid="import-history"]')
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    },
    {
      id: "import.export",
      label: "Take data out instead",
      keywords: "export download csv out extract",
      run: () => navigate("/exports"),
    },
  ]);

  return { opened, current, catalogue, listing, targets, chosen, setTarget, mapping, setMapping, refresh, open, close, begun, mapped, executed, discarded };
}
