import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useNavigate } from "react-router-dom";

import { logsApi, type LogLevel } from "@/api/logs";
import { useAuth } from "@/auth/AuthProvider";
import { usePageCommands } from "@/commands/CommandContext";
import { useListSearch } from "@/hooks/useListSearch";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { apiMessageToast } from "@/lib/errors";
import { STALE, queryKeys } from "@/lib/queryKeys";
import { FEATURES, useFeature } from "@/settings/features";

import { useLogTail } from "./useLogTail";

/**
 * The log's question in the address, its reads, the tail and retention.
 *
 * The address follows the *settled* search, so a reload restores the question
 * rather than a half-typed one — and typing does not push forty history
 * entries (§69). Any change of question starts at the first page: page 3 of a
 * different filter is a page nobody asked for.
 */
export function useLogsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const { profile } = useAuth();
  const search = useListSearch({ pageParam: "page" });
  const { params, term, set } = search;
  const minLevel = (params.get("min_level") ?? "") as LogLevel | "";
  const service = params.get("service") ?? "";
  const environment = params.get("environment") ?? "";
  const page = Number(params.get("page") ?? 1);
  const overlay = useUrlOverlay("line");
  const opened = overlay.value;
  const tailOn = useFeature(FEATURES.liveLogStream);

  const filters = {
    ...(term ? { q: term } : {}),
    ...(minLevel ? { min_level: minLevel } : {}),
    ...(service ? { service } : {}),
    ...(environment ? { environment } : {}),
  };
  const tail = useLogTail(filters);
  const { live, setLive } = tail;

  const catalogue = useQuery({
    queryKey: queryKeys.logs("catalogue"),
    queryFn: ({ signal }) => logsApi.catalogue(signal),
    staleTime: STALE.minute,
  });

  const listing = useQuery({
    queryKey: queryKeys.logs("list", filters, page),
    queryFn: ({ signal }) => logsApi.list({ ...filters, page, page_size: 50 }, signal),
    // While the tail is running the table is the stream, so the paged read is
    // not refetched underneath it.
    enabled: !live,
  });

  const detail = useQuery({
    queryKey: queryKeys.logs("entry", opened),
    queryFn: ({ signal }) => logsApi.entry(opened!, signal),
    enabled: opened !== null,
  });

  const prune = useMutation({
    mutationFn: () => logsApi.prune(),
    onSuccess: async (result) => {
      message.success(
        result.removed === 0
          ? `Nothing was older than ${result.retention_days} days.`
          : `${result.removed.toLocaleString()} lines older than ${result.retention_days} days removed.`,
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.logs() });
    },
    onError: apiMessageToast(message, "That was refused."),
  });

  usePageCommands("admin-logs", [
    { id: "logs.errors", label: "Show errors and worse", keywords: "logs errors critical failures", run: () => set({ min_level: "ERROR" }) },
    ...(tailOn
      ? [{ id: "logs.live", label: "Follow the log live", keywords: "logs tail follow live stream", run: () => setLive(true) }]
      : []),
    {
      id: "logs.warnings",
      label: "Show warnings and worse",
      keywords: "logs warnings warn notice attention",
      run: () => set({ min_level: "WARNING" }),
    },
    {
      id: "logs.all",
      label: "Show every line",
      keywords: "logs all clear filter debug info everything",
      run: () => set({ min_level: null, q: null }),
    },
    { id: "logs.jobs", label: "See what the platform is running", keywords: "jobs queue background workers", run: () => navigate("/admin/jobs") },
  ]);

  const canPrune = profile?.permissions.includes("settings.manage") ?? false;
  return { search, minLevel, service, overlay, tailOn, tail, catalogue, listing, detail, prune, canPrune };
}
