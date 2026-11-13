/**
 * `/admin/logs` — what the platform has been doing, and why (§22).
 *
 * Five decisions worth stating.
 *
 * **The level strip is a severity floor, not a set of toggles.** Clicking
 * WARNING means "warnings and worse", because that is what somebody clicking
 * it wants: they are looking for trouble and an ERROR hidden behind the filter
 * chosen to find it is the worst thing a log viewer can do. The server owns the
 * ranking, so this page never has to know it. Every level is offered even at
 * nought — a chip that appears only once something breaks is a chip people
 * learn to stop looking for (§76).
 *
 * **One search box, and it searches the ids too.** Paste the correlation id
 * from an error screen and the request is there. That is the whole reason the
 * column exists, and making somebody choose a field first would hide it behind
 * a decision they cannot make until they know the answer.
 *
 * **Live is a poll the reader controls.** Pause stops asking; resume asks from
 * the cursor it stopped at, so nothing is missed and nothing is repeated.
 * Deliberately not a socket: see `api/logs.ts`. The tail respects the filters
 * beside it, because a pause that changed what you were looking at would be
 * worse than no pause.
 *
 * **A log line is one line.** Monospace, fixed columns, no wrapping — this is a
 * page somebody scans two hundred rows of, and a table whose rows change height
 * with the length of a message cannot be scanned at all. The message is clipped
 * and the full text is in the pane.
 *
 * **The detail pane carries the whole request, not just the line.** The context,
 * the stack trace, and the sibling lines sharing the correlation id: one failure
 * is rarely one line, and reading "permission denied" without the request that
 * caused it is reading half the story.
 */

import { Alert, Drawer, Select, Skeleton, Tag, Tooltip } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";

import type { LogLine } from "@/api/logs";
import { URL_OVERLAY } from "@/app/history";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ListBar, ListPanel } from "@/components/listing/ListBar";
import { ResponsiveTable } from "@/components/listing/ResponsiveTable";
import { apiMessage } from "@/lib/errors";

import { LevelStrip } from "./LevelStrip";
import { LineDetail } from "./LineDetail";
import { LogActions } from "./LogActions";
import { logCard, logColumns } from "./logColumns";
import { useLogsPage } from "./useLogsPage";

export { paceOf, toneFor } from "./logFormat";

type Page = ReturnType<typeof useLogsPage>;

export default function LogsPage() {
  const page = useLogsPage();
  const { search, minLevel, catalogue, tail } = page;

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 12 }} />;

  if (catalogue.isError) {
    return (
      <div className="nx-ad nx-ad--logs">
        <PageHeader title={<>System <em>logs</em></>} />
        <Alert type="error" showIcon message={apiMessage(catalogue.error, "The log could not be read.")} />
      </div>
    );
  }

  const { levels, retention_days: retention, total } = catalogue.data!;

  return (
    <div className="nu-fill nx-ad nx-ad--logs">
      <PageHeader
        title={<>System <em>logs</em></>}
        subtitle="What the platform has been doing. Every request it serves is here, under the correlation id its response carried."
        tag={
          retention === null ? (
            <Tag>no retention policy</Tag>
          ) : (
            <Tooltip title="From `retention.log_days` in the system settings.">
              <Tag>kept {retention} days</Tag>
            </Tooltip>
          )
        }
        actions={<LogActions page={page} retention={retention} />}
      />

      <LogFilters page={page} />

      <LevelStrip total={total} levels={levels} minLevel={minLevel} onChoose={(level) => search.set({ min_level: level })} />

      {tail.live && (
        <Alert
          className="nu-block"
          type="info"
          showIcon
          icon={<PlayCircleOutlined />}
          data-testid="live-banner"
          message={
            tail.streamed.length === 0
              ? "Following the log. Nothing new yet — every request the platform serves will appear here."
              : `Following the log — ${tail.streamed.length.toLocaleString()} ${tail.streamed.length === 1 ? "line" : "lines"} since you started.`
          }
        />
      )}

      <LogTable page={page} />

      <LineDrawer page={page} />
    </div>
  );
}

function LogFilters({ page }: { page: Page }) {
  const { search, service, listing } = page;
  return (
    <ListBar
      search={{
        placeholder: "Filter by message, source, or a correlation id",
        "aria-label": "Search the log",
        value: search.box,
        onChange: (event) => search.setBox(event.target.value),
      }}
    >
      <Select
        aria-label="Service"
        value={service || "all"}
        className={service ? "nx-ad-set" : undefined}
        popupMatchSelectWidth={false}
        style={{ minWidth: 160 }}
        onChange={(next) => search.set({ service: next === "all" ? null : next })}
        options={[
          { value: "all", label: "Service: any" },
          ...(listing.data?.facets["service"] ?? []).map((item) => ({
            value: item.value,
            label: `${item.value} (${item.count})`,
          })),
        ]}
      />
    </ListBar>
  );
}

function LogTable({ page }: { page: Page }) {
  const { search, minLevel, service, overlay, listing, tail } = page;
  const { live } = tail;
  return (
    <ListPanel className="nu-log">
      <ResponsiveTable<LogLine>
        card={logCard}
        size="small"
        rowKey="id"
        data-testid="log-table"
        columns={logColumns}
        dataSource={live ? tail.streamed : (listing.data?.items ?? [])}
        loading={!live && listing.isLoading}
        onRow={(row) => ({ onClick: () => overlay.open(row.id), style: { cursor: "pointer" } })}
        rowClassName={(row) => `nu-log-row is-${row.level.toLowerCase()}`}
        locale={{
          emptyText: (
            <EmptyState
              compact
              title={search.term || minLevel || service ? "No line matches that." : "Nothing has been logged yet."}
            />
          ),
        }}
        pagination={
          live
            ? false
            : {
                current: listing.data?.page ?? 1,
                pageSize: listing.data?.page_size ?? 50,
                total: listing.data?.total ?? 0,
                showSizeChanger: false,
                onChange: (next) => search.set({ page: String(next) }),
                showTotal: (count) => `${count.toLocaleString()} lines`,
              }
        }
      />
    </ListPanel>
  );
}

function LineDrawer({ page }: { page: Page }) {
  const { overlay, detail } = page;
  return (
    <Drawer
      className="nx-ad-drawer"
      open={overlay.value !== null}
      rootClassName={URL_OVERLAY}
      onClose={() => overlay.close()}
      width={620}
      title="One log line"
      destroyOnClose
    >
      {detail.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}
      {detail.isError && <Alert type="error" showIcon message={apiMessage(detail.error, "That line could not be read.")} />}
      {detail.data && <LineDetail entry={detail.data} onOpen={(id) => overlay.open(id)} />}
    </Drawer>
  );
}
