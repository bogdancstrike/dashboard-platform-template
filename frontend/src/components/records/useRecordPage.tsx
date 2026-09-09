/**
 * The half three work pages share: one record, loaded, and written a field at
 * a time (§8, §9, §73).
 *
 * `/tasks/:id`, `/projects/:id` and `/tickets/:id` look nothing alike on
 * purpose — a work page, a delivery review and a support console are three
 * jobs, not one page with different labels. What they cannot differ on is the
 * *contract*: which record is open, what happens while it loads, what a
 * failure says, and what it means to change one field without opening a form.
 * Written three times, that contract would be three answers to "what does a
 * stale edit do", and two of them would be wrong.
 *
 * So this holds the parts that must agree and none of the parts that must not.
 * It returns data, a mutation and a fallback to render; it has no opinion
 * about layout, and the moment it grows one it has become the generic detail
 * page these three exist to replace.
 *
 * **A field written from the page carries the version it read.** The board's
 * drag, the ticket's severity and the project's health all go through one
 * mutation that sends `expected_updated_at`, so an edit written against a
 * record somebody else has moved is refused and reloaded rather than silently
 * applied over theirs (§73).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Skeleton } from "antd";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { explorerApi } from "@/api/explorer";
import { recordsApi, type RecordDetail } from "@/api/records";
import { FailureAlert, failureKind, retryHelps } from "@/components/FailureAlert";
import { PageHeader } from "@/components/PageHeader";
import { useRecordEditing, type RecordEditing } from "@/components/records/useRecordEditing";

export interface RecordPage {
  /** The record, once it has arrived. `undefined` while `fallback` is showing. */
  record: RecordDetail | undefined;
  /** One declared field's current value. */
  value: (name: string) => unknown;
  /** The vocabulary a select should offer, from the catalogue rather than the
   *  record — read off the record, a status menu offers only today's status. */
  choices: (name: string) => string[];
  /** Create, edit, delete and the drawer, exactly as every list page has it. */
  editing: RecordEditing;
  /** Write named fields straight from the page, with the version read. */
  write: (changes: Record<string, unknown>) => void;
  /** True while a written field is in flight, so a control can show it. */
  writing: boolean;
  /** The skeleton or the failure, when there is no record to draw yet. */
  fallback: ReactNode | null;
}

export function useRecordPage(
  resourceKey: string,
  id: string,
  options: { listPath: string; noun: string },
): RecordPage {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const record = useQuery({
    queryKey: ["record", resourceKey, id],
    queryFn: ({ signal }) => recordsApi.get(resourceKey, id, signal),
    enabled: Boolean(id),
  });

  const catalogue = useQuery({
    queryKey: ["explorer-catalogue"],
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: 60_000,
  });
  const resource = catalogue.data?.items.find((item) => item.key === resourceKey);

  const editing = useRecordEditing(resource, { onDeleted: () => navigate(options.listPath) });

  const patch = useMutation({
    mutationFn: (changes: Record<string, unknown>) =>
      recordsApi.update(resourceKey, id, {
        ...changes,
        expected_updated_at: record.data?.updated_at ?? null,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["record", resourceKey, id], saved);
      // Every list, lane and aggregate that could be showing this row is now
      // stale — including the counts, which are computed over the whole
      // dataset and cannot be adjusted in the browser without lying.
      void queryClient.invalidateQueries({ queryKey: ["entity-rows"] });
      void queryClient.invalidateQueries({ queryKey: ["entity-insights"] });
      void queryClient.invalidateQueries({ queryKey: ["task-lane"] });
      void queryClient.invalidateQueries({ queryKey: ["record-analysis"] });
      void queryClient.invalidateQueries({ queryKey: ["audit", "timeline", resourceKey, id] });
    },
    onError: (error) => {
      const stale = error instanceof ApiError && error.status === 409;
      message.error(
        stale
          ? `Somebody else changed this ${options.noun} while you had it open — reloading it.`
          : error instanceof ApiError
            ? error.message
            : "That change was not saved.",
      );
      if (stale) void record.refetch();
    },
  });

  return {
    record: record.data,
    value: (name) => record.data?.fields.find((field) => field.name === name)?.value,
    choices: (name) => resource?.fields.find((field) => field.name === name)?.choices ?? [],
    editing,
    write: (changes) => patch.mutate(changes),
    writing: patch.isPending,
    fallback: record.isLoading ? (
      <Skeleton active paragraph={{ rows: 10 }} />
    ) : record.isError ? (
      <ReadFailure
        error={record.error}
        noun={options.noun}
        onBack={() => navigate(options.listPath)}
        onRetry={() => void record.refetch()}
      />
    ) : null,
  };
}

/**
 * Why the record is not on screen, in words, with the id to quote.
 *
 * A page that fails silently, or that shows an empty layout where a record
 * should be, is a bug (§34, §76). "Not found" and "not permitted" are
 * deliberately different messages, because they lead somewhere different —
 * and neither of them is a retry, so both offer the way back to the list
 * instead of a button that will fail identically.
 */
function ReadFailure({
  error,
  noun,
  onBack,
  onRetry,
}: {
  error: Error;
  noun: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  const kind = failureKind(error);

  return (
    <>
      <PageHeader
        title={
          kind === "not_found"
            ? `${capitalise(noun)} not found`
            : kind === "forbidden"
              ? `You may not open this ${noun}`
              : `Could not open this ${noun}`
        }
        onBack={onBack}
      />
      <FailureAlert
        error={error}
        titles={{
          not_found: "Nothing at this address",
          forbidden: `Your role does not include this ${noun}`,
          failed: `Could not open this ${noun}`,
        }}
        onRetry={onRetry}
        action={
          retryHelps(kind) ? undefined : (
            <Button size="small" onClick={onBack}>
              Back to the list
            </Button>
          )
        }
      />
    </>
  );
}

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
