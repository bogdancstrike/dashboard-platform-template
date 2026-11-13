/**
 * `/admin/jobs` — what ran, what failed, and what can be tried again (§23).
 *
 * Five decisions worth stating.
 *
 * **Every control asks the server whether it is allowed.** `can_retry` and
 * `can_cancel` arrive on each row; this page never decides for itself whether a
 * job may be retried. The rules are stateful — terminal or not, within
 * `max_attempts` or not, a kind this console owns or not — and a browser
 * re-deriving them would eventually draw a button the endpoint refuses, which
 * is worse than no button. `whyNot` only *explains* the answer; it never
 * decides it.
 *
 * **A refusal is a disabled control with the reason, not a missing one.**
 * Retrying a running job is something an operator will reasonably *try*; the
 * answer is "not while it is running", said before they click (§76). Contrast
 * the settings page, where a card a reader may not open is absent — there the
 * reason is a permission, which will not change while they look at it.
 *
 * **Progress is a number and a bar, not a bar.** A bar alone cannot be read
 * out, compared between rows, or seen by somebody who cannot distinguish its
 * fill from its track (§64) — and "40%" of what matters, so the units are
 * beside it.
 *
 * **Attempts are on the face of the row.** "Failed" and "failed three times"
 * are different problems, and a queue that shows only the latest status makes
 * the second one invisible until somebody opens each row.
 *
 * **The status strip counts the whole queue, not the page.** Clicking a status
 * narrows the table and leaves the counts alone, so the strip stays a map of
 * the queue rather than a description of what is currently on screen (§71).
 */

import { Alert, Drawer, Select, Skeleton, Space, Tag } from "antd";

import type { Job } from "@/api/jobs";
import { URL_OVERLAY } from "@/app/history";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ListBar, ListPanel } from "@/components/listing/ListBar";
import { ResponsiveTable } from "@/components/listing/ResponsiveTable";
import { apiMessage } from "@/lib/errors";

import { JobDetailPane } from "./JobDetailPane";
import { StatusStrip } from "./StatusStrip";
import { jobCard, jobColumns } from "./jobColumns";
import { useJobsPage } from "./useJobsPage";

export { formatDuration, progressLabel, toneFor, whyNot } from "./jobFormat";

const READ_ONLY = (
  <Alert
    className="nu-block"
    type="info"
    showIcon
    data-testid="read-only"
    message="You can watch the queue but not change it."
    description="Retrying a job re-runs real work against real records, so it needs `jobs.manage`."
  />
);

export default function JobsPage() {
  const page = useJobsPage();
  const { search, status, catalogue, listing } = page;

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (catalogue.isError) {
    return (
      <div className="nx-ad nx-ad--jobs">
        <PageHeader title={<>Background <em>jobs</em></>} />
        <Alert type="error" showIcon message={apiMessage(catalogue.error, "The queue could not be read.")} />
      </div>
    );
  }

  const { statuses, can_manage: canManage, total } = catalogue.data!;
  const running = statuses.find((entry) => entry.key === "RUNNING")?.count ?? 0;

  return (
    <div className="nu-fill nx-ad nx-ad--jobs">
      <PageHeader
        title={<>Background <em>jobs</em></>}
        subtitle="What the platform has run, what failed, and what can be tried again."
        tag={running > 0 ? <Tag color="processing">{running} running</Tag> : <Tag>nothing running</Tag>}
        actions={
          <Space size={8}>
            <AutoRefresh
              page="jobs"
              defaultSeconds={30}
              updatedAt={listing.dataUpdatedAt}
              busy={listing.isFetching}
              refresh={() => void listing.refetch()}
            />
          </Space>
        }
      />

      <JobFilters page={page} />

      <StatusStrip total={total} statuses={statuses} status={status} onChoose={(next) => search.set({ status: next })} />

      {!canManage && READ_ONLY}

      <JobTable page={page} canManage={canManage} />

      <JobDrawer page={page} canManage={canManage} />
    </div>
  );
}

function JobFilters({ page }: { page: ReturnType<typeof useJobsPage> }) {
  const { search, queue, listing } = page;
  return (
    <ListBar
      search={{
        placeholder: "Search jobs by name, reference, or an error",
        "aria-label": "Search the queue",
        value: search.box,
        onChange: (event) => search.setBox(event.target.value),
      }}
    >
      <Select
        aria-label="Queue"
        value={queue || "all"}
        className={queue ? "nx-ad-set" : undefined}
        popupMatchSelectWidth={false}
        style={{ minWidth: 150 }}
        onChange={(next) => search.set({ queue: next === "all" ? null : next })}
        options={[
          { value: "all", label: "Queue: any" },
          ...(listing.data?.facets["queue"] ?? []).map((item) => ({
            value: item.value,
            label: `${item.value} (${item.count})`,
          })),
        ]}
      />
    </ListBar>
  );
}

function JobDrawer({ page, canManage }: { page: ReturnType<typeof useJobsPage>; canManage: boolean }) {
  const { overlay, detail, act } = page;
  return (
    <Drawer
      className="nx-ad-drawer"
      open={overlay.value !== null}
      rootClassName={URL_OVERLAY}
      onClose={() => overlay.close()}
      width={620}
      title="One job"
      destroyOnClose
    >
      {detail.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}
      {detail.isError && <Alert type="error" showIcon message={apiMessage(detail.error, "That job could not be read.")} />}
      {detail.data && (
        <JobDetailPane
          job={detail.data}
          canManage={canManage}
          busy={act.isPending}
          onAct={(action) => act.mutate({ id: detail.data.id, action, job: detail.data })}
        />
      )}
    </Drawer>
  );
}

function JobTable({ page, canManage }: { page: ReturnType<typeof useJobsPage>; canManage: boolean }) {
  const { search, status, queue, overlay, listing, act } = page;
  return (
    <ListPanel className="nu-job">
      <ResponsiveTable<Job>
        card={jobCard}
        size="small"
        rowKey="id"
        data-testid="jobs-table"
        columns={jobColumns(canManage, (args) => act.mutate(args), act.isPending)}
        dataSource={listing.data?.items ?? []}
        loading={listing.isLoading}
        onRow={(row) => ({ onClick: () => overlay.open(row.id), style: { cursor: "pointer" } })}
        locale={{
          emptyText: (
            <EmptyState
              compact
              title={search.term || status || queue ? "No job matches that." : "Nothing has been queued yet."}
            />
          ),
        }}
        pagination={{
          current: listing.data?.page ?? 1,
          pageSize: listing.data?.page_size ?? 25,
          total: listing.data?.total ?? 0,
          showSizeChanger: false,
          onChange: (next) => search.set({ page: String(next) }),
          showTotal: (count) => `${count.toLocaleString()} jobs`,
        }}
      />
    </ListPanel>
  );
}
