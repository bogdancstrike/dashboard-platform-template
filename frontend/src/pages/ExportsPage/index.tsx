/**
 * `/exports` — the exports you asked for, and the files they became (§30).
 *
 * Six decisions worth stating.
 *
 * **The page asks how big it is before it asks how to do it.** `estimate`
 * answers with a row count and two booleans, and those decide whether the
 * primary action is "Download now" or "Queue it". A page that queued a
 * background job for forty rows would be adding a step and a wait to something
 * that was already instant; one that tried to stream two hundred thousand rows
 * gets the refusal `core/export` exists to give. So the row count is shown
 * *before* either button, because it is the fact that chooses between them.
 *
 * **The ceilings on the page are the ceilings the API enforces.** They come
 * from the catalogue, which reads them from the settings table. A page that
 * printed 100,000 while `limits.max_export_rows` said 250,000 would be lying
 * about the product's own limits, and the number an administrator edits would
 * appear to do nothing.
 *
 * **Six statuses become four situations.** QUEUED and RUNNING are both "being
 * produced"; SUCCEEDED with a file is "ready"; SUCCEEDED whose file has expired
 * is a different thing from FAILED, and both are different again from *stalled*
 * — pending so long that nothing is going to pick it up, which is what a
 * restart mid-export leaves behind. `situation` is where that mapping lives,
 * asserted directly, because a row somebody has to act on must not read like
 * one they can wait for.
 *
 * **A dead download is never offered.** `downloadable` arrives on the row and
 * this page never re-derives it: whether a file exists depends on retention, on
 * whether it was discarded, and on what is actually in object storage — three
 * things a browser cannot know. Expired and discarded rows show what they were
 * instead, with "Request it again" where the download used to be.
 *
 * **"Request it again" is not a retry, and is not labelled as one.** It asks
 * the stored question afresh, so the answer describes the data as it is now.
 * Calling it Retry would suggest the old file was coming back.
 *
 * **Letting one go takes two presses, and the copy changes between them.** The
 * first press deletes the file and says the record is kept; the second removes
 * the record and says where the history went. A confirmation that promised to
 * keep something and then removed it on the next press would be the page
 * contradicting itself, so the button reads "Discard" while there is a file
 * and "Remove" once there is not.
 */

import type { MouseEvent } from "react";
import { Alert, Button, Card, Drawer, Segmented, Skeleton, Space } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";

import type { ExportRow } from "@/api/exports";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ResponsiveTable } from "@/components/listing/ResponsiveTable";

import { ExportDetail } from "./ExportDetail";
import { NewExportDrawer } from "./NewExportDrawer";
import { STATUS_LABELS, countLabel, summary } from "./exportCopy";
import { exportCard, exportColumns } from "./exportColumns";
import { useExportsPage } from "./useExportsPage";

export { advice, situation, tone } from "./exportCopy";

export default function ExportsPage() {
  const page = useExportsPage();
  const { status, catalogue, detail, refresh } = page;

  return (
    <div className="nu-exp nx-ad nx-ad--exports">
      <PageHeader
        title="Exports"
        subtitle={summary(catalogue.data)}
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
              Refresh
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              data-testid="new-export"
              onClick={() => page.setComposing(true)}
            >
              New export
            </Button>
          </Space>
        }
      />

      {catalogue.data && catalogue.data.stalled > 0 ? (
        <Alert
          type="warning"
          showIcon
          className="nu-exp-notice"
          data-testid="stalled-notice"
          message={
            catalogue.data.stalled === 1
              ? "One export stopped without finishing"
              : `${catalogue.data.stalled} exports stopped without finishing`
          }
          description="Exports run inside the API process, so a restart while one was in flight leaves it queued with nothing to pick it up. Request those again."
        />
      ) : null}

      <Segmented
        className="nu-exp-filter"
        value={status || "all"}
        onChange={(value) => page.chooseStatus(String(value))}
        options={[
          { label: `All ${countLabel(catalogue.data?.total)}`, value: "all" },
          ...(catalogue.data?.statuses ?? []).map((entry) => ({
            label: `${STATUS_LABELS[entry.key]} ${countLabel(entry.count)}`,
            value: entry.key,
          })),
        ]}
      />

      <ExportsTable page={page} />

      <Drawer
        className="nx-ad-drawer"
        title={detail ? `${detail.reference} · ${detail.name}` : "Export"}
        width={520}
        open={Boolean(detail)}
        onClose={page.closeExport}
      >
        {detail ? <ExportDetail row={detail} catalogue={catalogue.data} /> : null}
      </Drawer>

      <NewExportDrawer page={page} />
    </div>
  );
}

function ExportsTable({ page }: { page: ReturnType<typeof useExportsPage> }) {
  const { listing, rows } = page;
  return (
    <>
      {listing.isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        // A glass panel round the table, as every other list (and the design):
        // bare, the rows floated on the page ground.
        <Card className="nu-pane--table nu-exp-pane">
          <ResponsiveTable<ExportRow>
            card={exportCard}
            className="nu-exp-table"
            scroll={{ x: 1000 }}
            onRow={(row) => ({
              // The phone's card opens the detail; on a desk the reference does.
              // No event when a phone card is pressed — that press is always "open".
              onClick: (event?: MouseEvent) => {
                const target = event?.target;
                if (target instanceof Element && target.closest("button, a")) return;
                page.openExport(row.id);
              },
            })}
            data-testid="exports-table"
            rowKey="id"
            size="middle"
            dataSource={rows}
            columns={exportColumns(page)}
            pagination={false}
            locale={{
              emptyText: (
                <EmptyState title={
                    <span>
                      You have not exported anything yet. Any list in the platform can be
                      exported, and one too large to download arrives here.
                    </span>
                  } />
              ),
            }}
          />
        </Card>
      )}
    </>
  );
}
