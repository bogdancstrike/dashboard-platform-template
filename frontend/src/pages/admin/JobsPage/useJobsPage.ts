import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";

import { jobsApi, type Job } from "@/api/jobs";
import { usePageCommands } from "@/commands/CommandContext";
import { useListSearch } from "@/hooks/useListSearch";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { apiMessageToast } from "@/lib/errors";
import { STALE, queryKeys } from "@/lib/queryKeys";

import type { Verb } from "./jobFormat";

/** The queue's filters and page in the address, its reads, and the three things done to a job. */
export function useJobsPage() {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const search = useListSearch({ pageParam: "page" });
  const { params, term, set } = search;
  const status = params.get("status") ?? "";
  const queue = params.get("queue") ?? "";
  const page = Number(params.get("page") ?? 1);
  const overlay = useUrlOverlay("job");
  const opened = overlay.value;

  const filters = {
    ...(term ? { q: term } : {}),
    ...(status ? { status } : {}),
    ...(queue ? { queue } : {}),
  };

  const catalogue = useQuery({
    queryKey: queryKeys.jobs("catalogue"),
    queryFn: ({ signal }) => jobsApi.catalogue(signal),
    staleTime: STALE.short,
  });

  const listing = useQuery({
    queryKey: queryKeys.jobs("list", filters, page),
    queryFn: ({ signal }) => jobsApi.list({ ...filters, page, page_size: 25 }, signal),
    // A queue moves, so this page opens with a refresh already running — the
    // one page where watching progress *is* the job. It is the reader's to
    // change or turn off, which is what it was not while the interval was a
    // constant here (§53).
  });

  const detail = useQuery({
    queryKey: queryKeys.jobs("entry", opened),
    queryFn: ({ signal }) => jobsApi.entry(opened!, signal),
    enabled: opened !== null,
  });

  const act = useMutation({
    mutationFn: ({ id, action, job }: { id: string; action: Verb; job?: Job }) => {
      if (action === "retry") return jobsApi.retry(id);
      if (action === "cancel") return jobsApi.cancel(id);
      // One more than it has, rather than a number somebody types: the useful
      // grant is "let it try again", and a spinner asking how many would be a
      // decision nobody has an opinion about.
      return jobsApi.allowAttempts(id, (job?.max_attempts ?? 1) + 1);
    },
    onSuccess: async (job, { action }) => {
      message.success(
        action === "retry"
          ? `${job.reference} is queued again — attempt ${job.attempt} of ${job.max_attempts}.`
          : action === "cancel"
            ? `${job.reference} was stopped.`
            : `${job.reference} may now be tried ${job.max_attempts} times. Retry is available.`,
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
    },
    // The server's own sentence, which names the state or the bound. A generic
    // "that failed" would throw away the only useful part.
    onError: apiMessageToast(message, "That was refused."),
  });

  usePageCommands("admin-jobs", [
    { id: "jobs.failed", label: "Show the jobs that failed", keywords: "jobs failed errors queue retry", run: () => set({ status: "FAILED" }) },
    {
      id: "jobs.running",
      label: "Show what is running now",
      keywords: "jobs running in progress active current",
      run: () => set({ status: "RUNNING" }),
    },
    {
      id: "jobs.queued",
      label: "Show what is waiting to run",
      keywords: "jobs queued pending backlog waiting",
      run: () => set({ status: "QUEUED" }),
    },
    { id: "jobs.all", label: "Show every job", keywords: "jobs all clear filter everything", run: () => set({ status: null }) },
    { id: "jobs.refresh", label: "Check the queue again", keywords: "refresh reload poll now", run: () => void listing.refetch() },
  ]);

  return { search, status, queue, overlay, catalogue, listing, detail, act };
}
