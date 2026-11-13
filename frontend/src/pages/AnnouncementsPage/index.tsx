/**
 * `/announcements` — what the platform has told everybody (§17, §34).
 *
 * Two audiences on one route, because they are looking at the same rows for
 * different reasons: a reader wants to know what applies to them *now*, and an
 * author wants to know what has been written and how far it got. So the page
 * is a segmented pair of views rather than two routes — the switch is one
 * click and the second tab simply is not there without
 * `announcements.manage`.
 *
 * Three decisions worth stating.
 *
 * **A notice is prose, so it is laid out as prose.** Not a table. The severity
 * and the window matter, but what a maintenance notice *says* is the reason
 * anybody opened the page, and a 240-character title truncated into a column
 * with the body behind a click is a page that has hidden the content.
 *
 * **Reading is recorded on arrival; acknowledging never is.** Marking a notice
 * read when it is on screen is honest — it *was* on screen. Agreeing to a
 * policy is a decision, so it takes a button, and the button says what it
 * commits the reader to.
 *
 * **Expired notices are one click away, not on the page.** A maintenance
 * window that has passed is history: worth being able to look up, not worth
 * being shown every morning. Which is also why the strip's counts are over
 * the *live* set only — a chip that counts history would send somebody
 * looking for notices that are not there.
 */

import { Alert, Button, Skeleton } from "antd";

import { ApiError } from "@/api/client";
import { AnnouncementEditor } from "@/components/announcements/AnnouncementEditor";
import { PageHeader } from "@/components/PageHeader";
import { queryKeys } from "@/lib/queryKeys";

import { AuthoringTable } from "./parts/AuthoringTable";
import { AnnouncementsHeader } from "./parts/AnnouncementsHeader";
import { ReadView } from "./parts/ReadView";
import { useAnnouncementsPage } from "./useAnnouncementsPage";

export default function AnnouncementsPage() {
  const page = useAnnouncementsPage();
  const { queryClient, modal, editing, setEditing, view, status, set, feed, drafts, remove } = page;
  if (feed.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (feed.isError) {
    return (
      <>
        <PageHeader title="Announcements" />
        <Alert
          type="error"
          showIcon
          message={
            feed.error instanceof ApiError
              ? feed.error.message
              : "Announcements could not be loaded."
          }
          action={<Button onClick={() => void feed.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  return (
    <>
      <AnnouncementsHeader page={page} />

      {view === "read" ? (
        <ReadView page={page} />
      ) : (
        <AuthoringTable
          drafts={drafts}
          status={status}
          onStatus={(next) => set({ status: next })}
          onEdit={(notice) => setEditing(notice)}
          onRemove={(notice) =>
            modal.confirm({
              title: `Withdraw “${notice.title}”?`,
              content:
                "It disappears from everybody's noticeboard. The audit trail keeps what it said.",
              okText: "Withdraw",
              okButtonProps: { danger: true },
              onOk: () => remove.mutateAsync(notice.id),
            })
          }
        />
      )}

      <AnnouncementEditor
        open={editing !== null}
        notice={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: queryKeys.announcements() });
          void queryClient.invalidateQueries({ queryKey: queryKeys.announcementDrafts() });
        }}
      />
    </>
  );
}
