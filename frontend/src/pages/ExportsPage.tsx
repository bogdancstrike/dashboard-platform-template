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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Drawer,
  Form,
  Popconfirm,
  Progress,
  Segmented,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  DownloadOutlined,
  PlusOutlined,
  RedoOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

import { readableSize } from "@/api/files";
import {
  exportsApi,
  type ExportCatalogue,
  type ExportEstimate,
  type ExportRow,
  type ExportStatus,
} from "@/api/exports";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { errorText } from "@/lib/errors";
import { formatNumber } from "@/lib/formats";
import { absoluteTime, relativeTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";

const { Text, Paragraph } = Typography;

/** How often to look again while something is still being produced. */
const WHILE_WORKING_MS = 2_000;

/**
 * What one export's row actually means, in a sentence.
 *
 * The whole argument of this page. Six statuses and three derived flags
 * collapse into four situations, and which one a row is in decides whether
 * somebody waits, acts, or does nothing. "Failed" and "nothing is going to
 * pick this up" both leave a person with no file, and only one of them is
 * worth waiting for.
 */
export function situation(row: ExportRow): string {
  if (row.stalled) {
    return "Stopped without finishing — nothing is going to pick it up";
  }
  if (row.status === "QUEUED") return "Waiting to start";
  if (row.status === "RUNNING" || row.status === "RETRYING") return "Being produced";
  if (row.status === "FAILED") return "Failed";
  if (row.status === "CANCELLED") return "Cancelled";
  if (row.expired) return "Finished — the file was kept for its retention window and has gone";
  if (!row.downloadable) return "Finished — the file has been discarded";
  return "Ready to download";
}

/**
 * The colour a row earns, and the reason most rows get none.
 *
 * Only two things on this page are worth colouring: a file somebody can take
 * away, and a row that needs them. Everything else — waiting, cancelled,
 * expired — is ordinary, and a list where every line is coloured is a list
 * where the colour says nothing (§64).
 */
export function tone(row: ExportRow): "success" | "error" | "warning" | undefined {
  if (row.stalled) return "warning";
  if (row.status === "FAILED") return "error";
  if (row.status === "SUCCEEDED" && row.downloadable) return "success";
  return undefined;
}

/** Whether this row is one the page should keep looking at. */
function working(row: ExportRow): boolean {
  return !row.stalled && ["QUEUED", "RUNNING", "RETRYING"].includes(row.status);
}

/**
 * What the drawer should offer for a query of this size, and why.
 *
 * Returned as a sentence rather than a boolean pair so the page and its tests
 * agree on the *reason*: "1,284 rows — small enough to download straight
 * away" and "184,203 rows — too many for this installation" lead to two
 * different buttons, and a reader deserves to know which before they press
 * one.
 */
export function advice(estimate: ExportEstimate): string {
  const rows = formatNumber(estimate.rows);
  if (estimate.rows === 0) return "Nothing matches this query yet.";
  if (estimate.too_large) {
    return `${rows} rows — more than this installation exports (${formatNumber(
      estimate.maximum,
    )}). Narrow the query.`;
  }
  if (estimate.can_stream) {
    return `${rows} rows — small enough to download straight away.`;
  }
  return `${rows} rows — too many to download in one request, so this becomes a background export.`;
}

const STATUS_LABELS: Record<ExportStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  RETRYING: "Retrying",
  SUCCEEDED: "Finished",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export default function ExportsPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [composing, setComposing] = useState(false);
  const [dataset, setDataset] = useState<string>("");
  const [format, setFormat] = useState<string>("csv");

  const opened = params.get("export") ?? "";
  const status = params.get("status") ?? "";

  const catalogue = useQuery({
    queryKey: ["exports", "catalogue"],
    queryFn: ({ signal }) => exportsApi.catalogue(signal),
  });

  const listing = useQuery({
    queryKey: ["exports", "list", status],
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
    queryKey: ["exports", "estimate", dataset, format],
    queryFn: ({ signal }) => exportsApi.estimate(request, signal),
    // Nothing to count until a dataset is chosen, and nothing worth counting
    // while the drawer is shut.
    enabled: composing && Boolean(dataset),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["exports"] });
  };

  const queued = useMutation({
    mutationFn: () => exportsApi.queue(request),
    onSuccess: async (made) => {
      setComposing(false);
      await refresh();
      message.success(`${made.reference} queued`);
      // Opened straight away, because the thing somebody wants next is the
      // file — and this is where it will appear.
      setParams((next) => {
        const merged = new URLSearchParams(next);
        merged.set("export", made.id);
        return merged;
      });
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "export" }));
    },
  });

  const asked = useMutation({
    mutationFn: (id: string) => exportsApi.again(id),
    onSuccess: async (made) => {
      await refresh();
      message.success(`Asked again as ${made.reference}`);
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "export" }));
    },
  });

  const discarded = useMutation({
    mutationFn: (id: string) => exportsApi.forget(id),
    onSuccess: async (answer) => {
      await refresh();
      // Two presses, two outcomes, and the message has to say which happened
      // or the second press looks like the first one not having worked.
      message.success(
        answer.removed
          ? `${answer.reference} has been removed from your list`
          : "The file has been discarded; the record is kept",
      );
      if (answer.removed && answer.id === opened) {
        setParams((next) => {
          const merged = new URLSearchParams(next);
          merged.delete("export");
          return merged;
        });
      }
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "export" }));
    },
  });

  const fetched = useMutation({
    mutationFn: (id: string) => exportsApi.download(id),
    onSuccess: (link) => {
      // A signed URL, opened rather than proxied: the bytes come from object
      // storage, so a finished export never costs the API worker twice.
      window.open(link.url, "_blank", "noopener,noreferrer");
    },
    onError: async (error: unknown) => {
      message.error(errorText(error, { action: "export" }));
      // The refusal is also news: an expired or missing file makes the row's
      // own answer stale, and the server has just corrected it.
      await refresh();
    },
  });

  usePageCommands("exports", [
    {
      id: "exports.new",
      label: "Export a dataset",
      keywords: "export download csv xlsx json extract",
      run: () => setComposing(true),
    },
    {
      id: "exports.ready",
      label: "Show the exports that are ready",
      keywords: "export finished ready download",
      run: () => setParams(new URLSearchParams({ status: "SUCCEEDED" })),
    },
    {
      id: "exports.failed",
      label: "Show the exports that failed",
      keywords: "export failed error problem broken",
      run: () => setParams(new URLSearchParams({ status: "FAILED" })),
    },
    {
      id: "exports.all",
      label: "Show every export",
      keywords: "export all clear filter everything mine",
      run: () => setParams(new URLSearchParams()),
    },
    {
      id: "exports.import",
      label: "Bring data in instead",
      keywords: "import csv upload spreadsheet load",
      run: () => navigate("/import"),
    },
  ]);

  const columns: ColumnsType<ExportRow> = [
    {
      title: "Reference",
      dataIndex: "reference",
      width: 130,
      render: (value: string, row) => (
        <Button
          type="text"
          className="nu-exp-open"
          data-testid={`exp-${row.reference}`}
          onClick={() =>
            setParams((next) => {
              const merged = new URLSearchParams(next);
              merged.set("export", row.id);
              return merged;
            })
          }
        >
          {value}
        </Button>
      ),
    },
    {
      title: "Export",
      dataIndex: "name",
      ellipsis: true,
      render: (value: string, row) => (
        <div className="nu-exp-what">
          <Text strong>{value}</Text>
          {/* The stored query, re-derived on the server from the field
              catalogue — never a sentence saved beside it. */}
          <Text type="secondary" className="nu-exp-question">
            {row.description}
          </Text>
        </div>
      ),
    },
    {
      title: "Where it stands",
      dataIndex: "status",
      width: 260,
      render: (_value, row) => {
        const colour = tone(row);
        return (
          <Space size={6} className="nu-exp-state">
            <Tag color={colour} bordered={false}>
              {STATUS_LABELS[row.status]}
            </Tag>
            <Text type={colour === "error" ? "danger" : "secondary"}>{situation(row)}</Text>
          </Space>
        );
      },
    },
    {
      title: "Rows",
      dataIndex: "rows",
      width: 100,
      align: "right",
      render: (value: number | null, row) =>
        // The file's count, once there is a file. Before that, progress over
        // the total counted when it was queued — never a number for a file
        // nobody has written.
        value === null ? (
          working(row) ? (
            <Progress
              // The only thing in the cell while the file is being written,
              // so it is named rather than hidden.
              aria-label={`${row.reference}: ${row.progress}% written`}
              percent={row.progress}
              size="small"
              showInfo={false}
              className="nu-exp-progress"
            />
          ) : (
            <Text type="secondary">—</Text>
          )
        ) : (
          <Text>{formatNumber(value)}</Text>
        ),
    },
    {
      title: "Size",
      dataIndex: "size_bytes",
      width: 90,
      align: "right",
      render: (value: number | null) =>
        value === null ? <Text type="secondary">—</Text> : readableSize(value),
    },
    {
      title: "Requested",
      dataIndex: "requested_at",
      width: 120,
      render: (value: string | null) => (
        <Tooltip title={absoluteTime(value)}>
          <span>{relativeTime(value)}</span>
        </Tooltip>
      ),
    },
    {
      title: "",
      width: 210,
      align: "right",
      render: (_value, row) => (
        <Space size={4}>
          {row.downloadable ? (
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              data-testid={`download-${row.reference}`}
              loading={fetched.isPending && fetched.variables === row.id}
              onClick={() => fetched.mutate(row.id)}
            >
              Download
            </Button>
          ) : (
            // Offered wherever there is no file, which is the only useful
            // action left on such a row.
            <Button
              icon={<RedoOutlined />}
              data-testid={`again-${row.reference}`}
              loading={asked.isPending && asked.variables === row.id}
              onClick={() => asked.mutate(row.id)}
            >
              Request again
            </Button>
          )}
          {/* Two presses, and the copy has to change between them: the first
              takes a copy of production data out of storage, the second tidies
              away a note. Telling somebody "the record is kept" and then
              removing it on the next press would be the page contradicting
              itself. */}
          <Popconfirm
            title={row.has_file ? "Discard this file?" : "Remove this record?"}
            description={
              row.has_file
                ? "The file is deleted. The record of having asked for it is kept."
                : "The export leaves your list. What you asked for and when stays in the audit trail."
            }
            okText={row.has_file ? "Discard the file" : "Remove it"}
            cancelText="Keep it"
            onConfirm={() => discarded.mutate(row.id)}
          >
            <Button
              type="text"
              data-testid={`discard-${row.reference}`}
              disabled={working(row)}
            >
              {row.has_file ? "Discard" : "Remove"}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="nu-exp">
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
              onClick={() => setComposing(true)}
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
        onChange={(value) =>
          setParams((next) => {
            const merged = new URLSearchParams(next);
            if (value === "all") merged.delete("status");
            else merged.set("status", String(value));
            return merged;
          })
        }
        options={[
          { label: `All ${countLabel(catalogue.data?.total)}`, value: "all" },
          ...(catalogue.data?.statuses ?? []).map((entry) => ({
            label: `${STATUS_LABELS[entry.key]} ${countLabel(entry.count)}`,
            value: entry.key,
          })),
        ]}
      />

      {listing.isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <Table<ExportRow>
          className="nu-exp-table"
          data-testid="exports-table"
          rowKey="id"
          size="middle"
          dataSource={rows}
          columns={columns}
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
      )}

      <Drawer
        title={detail ? `${detail.reference} · ${detail.name}` : "Export"}
        width={520}
        open={Boolean(detail)}
        onClose={() =>
          setParams((next) => {
            const merged = new URLSearchParams(next);
            merged.delete("export");
            return merged;
          })
        }
      >
        {detail ? <Detail row={detail} catalogue={catalogue.data} /> : null}
      </Drawer>

      <Drawer
        title="New export"
        width={480}
        open={composing}
        onClose={() => setComposing(false)}
        data-testid="new-export-drawer"
        footer={
          <Space className="nu-exp-actions">
            <Button onClick={() => setComposing(false)}>Cancel</Button>
            <Button
              type="primary"
              data-testid="queue-export"
              loading={queued.isPending}
              // Refused before it is pressed rather than after: the estimate
              // has already answered whether this query is exportable at all.
              disabled={!dataset || estimate.isLoading || estimate.data?.too_large === true}
              onClick={() => queued.mutate()}
            >
              {estimate.data?.can_stream ? "Export it" : "Queue it"}
            </Button>
          </Space>
        }
      >
        <Form layout="vertical">
          {/* `htmlFor` and `id` in pairs: without them AntD renders a label
              that neither names the control in the accessibility tree nor
              focuses it when clicked, and `Form.Item` only generates the link
              for fields it owns by `name`. */}
          <Form.Item label="Dataset" htmlFor="exp-dataset">
            <Select
              id="exp-dataset"
              value={dataset || undefined}
              onChange={setDataset}
              placeholder="Choose a dataset"
              options={(catalogue.data?.datasets ?? []).map((entry) => ({
                value: entry.key,
                label: entry.label,
              }))}
            />
          </Form.Item>
          <Form.Item label="Format" htmlFor="exp-format">
            <Select
              id="exp-format"
              value={format}
              onChange={setFormat}
              options={(catalogue.data?.formats ?? []).map((entry) => ({
                value: entry.key,
                label: `${entry.label} — up to ${formatNumber(entry.maximum)} rows`,
              }))}
            />
          </Form.Item>
        </Form>

        {estimate.isLoading ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : estimate.data ? (
          <Alert
            type={estimate.data.too_large ? "error" : "info"}
            showIcon
            data-testid="estimate"
            message={advice(estimate.data)}
            description={estimate.data.description}
          />
        ) : null}

        {catalogue.data ? (
          <Paragraph type="secondary" className="nu-exp-limits" data-testid="limits">
            A download stops at {formatNumber(catalogue.data.streams_up_to)} rows. A queued
            export goes up to {formatNumber(catalogue.data.max_rows)}, and its file is kept
            for {catalogue.data.retention_days} days.
          </Paragraph>
        ) : null}
      </Drawer>
    </div>
  );
}

/** One export, in full. */
function Detail({
  row,
  catalogue,
}: {
  row: ExportRow;
  catalogue: ExportCatalogue | undefined;
}) {
  return (
    <div className="nu-exp-detail" data-testid="export-detail">
      <Alert
        type={tone(row) === "error" ? "error" : tone(row) === "warning" ? "warning" : "info"}
        showIcon
        data-testid="export-situation"
        message={situation(row)}
        description={row.error_message ?? row.description}
      />

      <Descriptions column={1} size="small" className="nu-exp-facts">
        <Descriptions.Item label="Dataset">{row.resource_type}</Descriptions.Item>
        <Descriptions.Item label="Format">{row.format.toUpperCase()}</Descriptions.Item>
        <Descriptions.Item label="Columns">{row.columns.join(", ") || "—"}</Descriptions.Item>
        <Descriptions.Item label="Rows">
          {row.rows === null ? "—" : formatNumber(row.rows)}
        </Descriptions.Item>
        <Descriptions.Item label="Size">
          {row.size_bytes === null ? "—" : readableSize(row.size_bytes)}
        </Descriptions.Item>
        <Descriptions.Item label="Requested">{absoluteTime(row.requested_at)}</Descriptions.Item>
        <Descriptions.Item label="Finished">
          {row.finished_at ? absoluteTime(row.finished_at) : "—"}
        </Descriptions.Item>
        <Descriptions.Item label="File kept until">
          {row.expires_at
            ? absoluteTime(row.expires_at)
            : catalogue
              ? `${catalogue.retention_days} days after it finishes`
              : "—"}
        </Descriptions.Item>
        {/* Which of the platform's background mechanisms produced it. Said out
            loud because "background" hides three different things, and an
            operator reading a slow export needs to know which one they have. */}
        <Descriptions.Item label="Produced by">{row.ran_as || "—"}</Descriptions.Item>
      </Descriptions>

      {row.log_lines.length ? (
        <div className="nu-exp-log" data-testid="export-log">
          {row.log_lines.map((line, index) => (
            <div key={`${line.at ?? index}`} className="nu-exp-log-line">
              <Text type="secondary">{line.at ? absoluteTime(line.at) : ""}</Text>
              <Text type={line.level === "ERROR" ? "danger" : undefined}>{line.message}</Text>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The header's one sentence: what is here, and what the limits are. */
function summary(catalogue: ExportCatalogue | undefined): string {
  if (!catalogue) return "Exports you have asked for, and the files they became.";
  if (catalogue.total === 0) {
    return `Any list can be exported. Downloads stop at ${formatNumber(
      catalogue.streams_up_to,
    )} rows; larger ones are produced in the background.`;
  }
  const ready =
    catalogue.ready === 1 ? "1 file ready to download" : `${catalogue.ready} files ready`;
  return `${ready}. Files are kept for ${catalogue.retention_days} days.`;
}

function countLabel(count: number | undefined): string {
  return typeof count === "number" ? `(${count})` : "";
}
