/**
 * `/import` — loading a spreadsheet somebody exported from something else (§29).
 *
 * A wizard rather than a form, for the reason `CreateDashboardWizard` states:
 * **a drawer edits an object that exists, a wizard makes a decision that has
 * parts.** Which dataset, which column is which field, what is wrong with
 * which rows, and only then do it — four separate thoughts, and one form
 * asking all four at once gets a worse answer to each.
 *
 * Seven decisions worth the reader's attention.
 *
 * **The step comes from the server.** A draft holds its file and its `step`,
 * so reopening one lands where it was left rather than wherever the data
 * implies — a run whose mapping happens to be complete but which nobody has
 * looked at should land on the preview, not skip past it. That is what makes
 * the drafts on this page resumable rather than decorative.
 *
 * **The file is read in the browser and sent as text.** Not because it is
 * simpler: the API has to parse the CSV, so a presigned upload would move the
 * same bytes through the same worker twice. The size is checked here *and*
 * there, because a check only in the browser is not a check.
 *
 * **The detected separator is shown, not assumed.** Half the spreadsheets in
 * Europe are semicolon-separated because Excel follows the locale, and a
 * reader whose file came back as one column needs to see *why* and be able to
 * say otherwise. So the dialect note is on the page with the separator beside
 * it.
 *
 * **Mapping is one control per column, with samples.** Per column rather than
 * per field, because the file is the thing you are looking at and its columns
 * are what need explaining — and two columns called `name` are told apart by
 * what is in them, which is why the samples are there.
 *
 * **The preview shows the rows, with the problems on the rows.** Not a list of
 * errors beside a list of rows: the question a reader has is "what is wrong
 * with *this* line", and the line number is the file's own so it can be found
 * in the spreadsheet.
 *
 * **Every refusal is a disabled control with the reason.** Executing with a
 * required field unmapped is something somebody will reasonably try; the
 * answer is "these fields still need a column", said before they press it
 * (§76).
 *
 * **The error report is a download.** Two hundred bad rows get fixed in Excel,
 * and a screen cannot be sorted, filtered or pasted.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Empty,
  Popconfirm,
  Progress,
  Select,
  Skeleton,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import {
  DownloadOutlined,
  InboxOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  importsApi,
  type ImportCatalogue,
  type ImportDetail,
  type ImportRun,
  type ImportStatus,
  type ImportTarget,
  type PreviewRow,
} from "@/api/imports";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { errorText } from "@/lib/errors";
import { formatNumber } from "@/lib/formats";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text, Paragraph } = Typography;

/** How often to look again while an execute is in flight. */
const WHILE_RUNNING_MS = 1_500;

/** The four steps, in the order the decision has parts. */
const STEPS = [
  { key: "UPLOAD", title: "File" },
  { key: "MAPPING", title: "Columns" },
  { key: "PREVIEW", title: "Check" },
  { key: "DONE", title: "Done" },
] as const;

/**
 * Which step a run is on, as an index into the strip.
 *
 * Read from the run's stored `step` rather than inferred from its data, which
 * is the whole reason that column exists: a draft whose mapping happens to be
 * complete has still not been *looked at*, and skipping it past the check
 * would defeat the point of the wizard.
 */
export function stepIndex(run: ImportRun | undefined): number {
  if (!run) return 0;
  if (run.step === "EXECUTE") return 3;
  const found = STEPS.findIndex((entry) => entry.key === run.step);
  return found < 0 ? 0 : found;
}

/**
 * What one run's numbers come to, in a sentence.
 *
 * The page's whole argument. Four counts and six statuses collapse into the
 * one thing a reader needs: whether to act, wait, or read the report. Stated
 * as a function so it can be asserted directly — the distinction between
 * "nothing in this file is usable" and "some of it is" decides whether the
 * execute button should exist at all.
 */
export function outcome(run: ImportRun): string {
  if (run.status === "DRAFT") {
    return run.unmapped_required.length
      ? `Needs a column for ${run.unmapped_required.join(", ")}`
      : `${formatNumber(run.total_rows)} rows read — check the columns`;
  }
  if (run.status === "RUNNING") return "Importing now";
  if (run.status === "CANCELLED") return "Discarded";
  if (run.status === "FAILED") {
    // All-or-nothing, so the useful fact is that nothing landed — not how far
    // it got.
    return "Failed — nothing was imported";
  }
  if (run.status === "COMPLETED") {
    return `${formatNumber(run.imported_rows)} of ${formatNumber(run.total_rows)} rows imported`;
  }
  if (run.valid_rows === 0) return "Nothing in this file can be imported";
  if (run.invalid_rows > 0) {
    return `${formatNumber(run.valid_rows)} ready, ${formatNumber(
      run.invalid_rows,
    )} to fix`;
  }
  return `${formatNumber(run.valid_rows)} rows ready to import`;
}

/**
 * The colour a run earns, and why most earn none.
 *
 * Only two things here are worth colouring: a file with problems somebody has
 * to fix, and one that finished. Draft, discarded and running are ordinary,
 * and a list where every line is coloured says nothing (§64).
 */
export function tone(run: ImportRun): "success" | "error" | "warning" | undefined {
  if (run.status === "FAILED") return "error";
  if (run.status === "COMPLETED") return "success";
  if (run.status === "VALIDATED" && run.invalid_rows > 0) return "warning";
  return undefined;
}

const STATUS_LABELS: Record<ImportStatus, string> = {
  DRAFT: "Draft",
  VALIDATED: "Checked",
  RUNNING: "Importing",
  COMPLETED: "Imported",
  FAILED: "Failed",
  CANCELLED: "Discarded",
};

export default function ImportPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [target, setTarget] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const opened = params.get("run") ?? "";

  const catalogue = useQuery({
    queryKey: ["imports", "catalogue"],
    queryFn: ({ signal }) => importsApi.catalogue(signal),
  });

  const listing = useQuery({
    queryKey: ["imports", "list"],
    queryFn: ({ signal }) => importsApi.list({ page_size: 25 }, signal),
  });

  const run = useQuery({
    queryKey: ["imports", "run", opened],
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
    await queryClient.invalidateQueries({ queryKey: ["imports"] });
  };

  const open = (id: string) =>
    setParams((next) => {
      const merged = new URLSearchParams(next);
      merged.set("run", id);
      return merged;
    });

  const close = () =>
    setParams((next) => {
      const merged = new URLSearchParams(next);
      merged.delete("run");
      return merged;
    });

  const begun = useMutation({
    mutationFn: (input: { filename: string; content: string }) =>
      importsApi.begin({
        target_entity: chosen?.key ?? "",
        filename: input.filename,
        content: input.content,
      }),
    onSuccess: async (made) => {
      await refresh();
      open(made.id);
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "import" }));
    },
  });

  const mapped = useMutation({
    mutationFn: () => importsApi.map(opened, mapping),
    onSuccess: async (answer) => {
      await refresh();
      message.success(
        answer.valid_rows
          ? `${formatNumber(answer.valid_rows)} rows are ready`
          : "Nothing in this file can be imported yet",
      );
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "import" }));
    },
  });

  const executed = useMutation({
    mutationFn: () => importsApi.execute(opened),
    onSuccess: async () => {
      await refresh();
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "import" }));
    },
  });

  const discarded = useMutation({
    mutationFn: (id: string) => importsApi.discard(id),
    onSuccess: async (answer) => {
      close();
      await refresh();
      // Which of the two happened, or the second press looks like the first
      // one not having worked.
      message.success(
        answer.removed
          ? `${answer.reference} has been removed from your list`
          : "Discarded. The record of the attempt is kept.",
      );
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "import" }));
    },
  });

  usePageCommands("import", [
    {
      id: "import.new",
      label: "Import a spreadsheet",
      keywords: "import csv upload spreadsheet load data",
      run: () => close(),
    },
  ]);

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  return (
    <div className="nu-imp">
      <PageHeader
        title="Import"
        subtitle={summary(catalogue.data)}
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
              Refresh
            </Button>
            {opened ? (
              <Button data-testid="start-over" onClick={close}>
                Start another
              </Button>
            ) : null}
          </Space>
        }
      />

      <Steps
        className="nu-imp-steps"
        size="small"
        current={stepIndex(current)}
        items={STEPS.map((entry) => ({ title: entry.title }))}
      />

      {opened && current ? (
        <Wizard
          run={current}
          catalogue={catalogue.data}
          mapping={mapping}
          onMap={setMapping}
          onCheck={() => mapped.mutate()}
          checking={mapped.isPending}
          onExecute={() => executed.mutate()}
          executing={executed.isPending}
          onDiscard={() => discarded.mutate(current.id)}
        />
      ) : (
        <Start
          targets={targets}
          catalogue={catalogue.data}
          chosen={chosen}
          onChoose={setTarget}
          onFile={(filename, content) => begun.mutate({ filename, content })}
          busy={begun.isPending}
        />
      )}

      <Card
        className="nu-imp-history"
        title="Earlier imports"
        size="small"
        data-testid="import-history"
      >
        {listing.isLoading ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : (
          <History
            rows={listing.data?.items ?? []}
            onOpen={open}
            onDiscard={(id) => discarded.mutate(id)}
          />
        )}
      </Card>
    </div>
  );
}

/** Step one: which dataset, and which file. */
function Start({
  targets,
  catalogue,
  chosen,
  onChoose,
  onFile,
  busy,
}: {
  targets: ImportTarget[];
  catalogue: ImportCatalogue | undefined;
  chosen: ImportTarget | undefined;
  onChoose: (key: string) => void;
  onFile: (filename: string, content: string) => void;
  busy: boolean;
}) {
  const { message } = AntApp.useApp();
  const limit = catalogue?.max_bytes ?? 0;

  return (
    <Card className="nu-imp-start" size="small" data-testid="import-start">
      <div className="nu-imp-choose">
        <Text strong>Into</Text>
        <Select
          id="imp-target"
          aria-label="Dataset"
          className="nu-imp-target"
          value={chosen?.key}
          onChange={onChoose}
          options={targets.map((entry) => ({ value: entry.key, label: entry.label }))}
        />
        {chosen ? (
          <Text type="secondary" data-testid="target-required">
            {chosen.required.length
              ? `Every row needs ${chosen.required
                  .map((name) => fieldLabel(chosen, name))
                  .join(", ")}.`
              : "No field is required, so a row with anything in it can be imported."}
          </Text>
        ) : null}
      </div>

      <Upload.Dragger
        className="nu-imp-drop"
        data-testid="import-drop"
        accept=".csv,.tsv,.txt,text/csv"
        multiple={false}
        showUploadList={false}
        disabled={busy || !chosen}
        beforeUpload={(file) => {
          // Checked here *and* on the server: a check only in the browser is
          // not a check, and one only on the server wastes an upload.
          if (limit && file.size > limit) {
            message.error(
              `That file is ${(file.size / 1_048_576).toFixed(1)} MB and the limit is ${(
                limit / 1_048_576
              ).toFixed(0)} MB.`,
            );
            return Upload.LIST_IGNORE;
          }
          void file
            .text()
            .then((content) => onFile(file.name, content))
            .catch(() => message.error("That file could not be read."));
          // Never handed to AntD's uploader: the text goes in a JSON body, so
          // there is no multipart request to make.
          return Upload.LIST_IGNORE;
        }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Drop a CSV here, or click to choose one</p>
        {/* The testid is on the hint rather than on the Dragger: AntD forwards
            a `data-*` to its outer wrapper, which carries no text — the same
            trap `Modal` sets. */}
        <p className="ant-upload-hint" data-testid="import-limits">
          {catalogue
            ? `Up to ${formatNumber(catalogue.max_rows)} rows. Comma, semicolon, tab or pipe — the separator is detected and shown.`
            : ""}
        </p>
      </Upload.Dragger>
    </Card>
  );
}

/** Steps two to four: map, check, run. */
function Wizard({
  run,
  catalogue,
  mapping,
  onMap,
  onCheck,
  checking,
  onExecute,
  executing,
  onDiscard,
}: {
  run: ImportDetail;
  catalogue: ImportCatalogue | undefined;
  mapping: Record<string, string>;
  onMap: (next: Record<string, string>) => void;
  onCheck: () => void;
  checking: boolean;
  onExecute: () => void;
  executing: boolean;
  onDiscard: () => void;
}) {
  const target = catalogue?.targets.find((entry) => entry.key === run.target_entity);
  const fields = target?.fields ?? [];
  const taken = new Set(Object.values(mapping).filter(Boolean));

  return (
    <>
      <Card size="small" className="nu-imp-file" data-testid="import-file">
        <Descriptions column={4} size="small">
          <Descriptions.Item label="Reference">{run.reference}</Descriptions.Item>
          <Descriptions.Item label="File">{run.filename}</Descriptions.Item>
          <Descriptions.Item label="Into">{run.target_label}</Descriptions.Item>
          <Descriptions.Item label="Rows">{formatNumber(run.total_rows)}</Descriptions.Item>
        </Descriptions>
        {run.dialect ? (
          <Alert
            type={run.dialect.consistent ? "info" : "warning"}
            showIcon
            className="nu-imp-dialect"
            data-testid="dialect"
            message={run.dialect.note}
            description={
              run.dialect.consistent
                ? undefined
                : "A value containing the separator is the usual cause. The rows that disagree are listed below."
            }
          />
        ) : null}
      </Card>

      {run.status === "COMPLETED" || run.status === "FAILED" ? (
        <Alert
          type={run.status === "COMPLETED" ? "success" : "error"}
          showIcon
          className="nu-imp-outcome"
          data-testid="import-outcome"
          message={outcome(run)}
          description={
            run.status === "FAILED"
              ? run.errors.find((problem) => problem.line === 0)?.message ??
                "Nothing was imported. The whole file is applied or none of it is."
              : `Imported into ${run.target_label}.`
          }
        />
      ) : null}

      {run.status !== "COMPLETED" && run.status !== "CANCELLED" ? (
        <Card
          size="small"
          title="Which column is which field"
          className="nu-imp-mapping"
          data-testid="import-mapping"
          extra={
            <Space>
              {/* Two presses, and the copy changes between them: telling
                  somebody "the record is kept" and then removing it on the
                  next press would be the page contradicting itself. */}
              <Popconfirm
                title={run.holds_file ? "Discard this import?" : "Remove this record?"}
                description={
                  run.holds_file
                    ? "The file is dropped. The record of having tried is kept."
                    : "The import leaves your list. What you tried and when stays in the audit trail."
                }
                okText={run.holds_file ? "Discard it" : "Remove it"}
                cancelText="Keep it"
                onConfirm={onDiscard}
              >
                <Button size="small" type="text" data-testid="discard-run">
                  {run.holds_file ? "Discard" : "Remove"}
                </Button>
              </Popconfirm>
              <Button
                size="small"
                type="primary"
                data-testid="check-mapping"
                loading={checking}
                onClick={onCheck}
              >
                Check the rows
              </Button>
            </Space>
          }
        >
          <div className="nu-imp-columns">
            {run.detected_columns.map((column) => (
              <div className="nu-imp-column" key={column.name}>
                <div className="nu-imp-column-head">
                  <Text strong>{column.name}</Text>
                  {/* Two columns called `name` are told apart by what is in
                      them, not by their position. */}
                  <Text type="secondary" className="nu-imp-samples">
                    {column.samples.length ? column.samples.join(" · ") : "empty"}
                  </Text>
                </div>
                <Select
                  className="nu-imp-field"
                  aria-label={`Field for ${column.name}`}
                  data-testid={`map-${column.name}`}
                  allowClear
                  placeholder="Ignore this column"
                  value={mapping[column.name] || undefined}
                  // `allowClear` calls back with `undefined`, which is how a
                  // column is un-mapped; the server reads an empty string as
                  // "ignore this column".
                  onChange={(value: string | undefined) =>
                    onMap({ ...mapping, [column.name]: value ?? "" })
                  }
                  options={fields.map((field) => ({
                    value: field.name,
                    label: `${field.label}${field.required ? " *" : ""}`,
                    // One field per column: the server refuses two, and
                    // offering a taken field would be drawing a control the
                    // endpoint rejects (§76).
                    disabled:
                      taken.has(field.name) && mapping[column.name] !== field.name,
                  }))}
                />
              </div>
            ))}
          </div>

          {run.unmapped_required.length ? (
            <Alert
              type="warning"
              showIcon
              className="nu-imp-missing"
              data-testid="unmapped"
              message={`Still needed: ${run.unmapped_required
                .map((name) => (target ? fieldLabel(target, name) : name))
                .join(", ")}`}
              description="Every row must have a value for these, so a column has to be chosen before anything can be imported."
            />
          ) : null}
        </Card>
      ) : null}

      {run.status === "VALIDATED" || run.status === "RUNNING" || run.error_count ? (
        <Card
          size="small"
          title="What the rows look like"
          className="nu-imp-preview"
          data-testid="import-preview"
          extra={
            <Space>
              {run.error_count ? (
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  data-testid="download-problems"
                  onClick={() => void importsApi.problems(run.id, run.reference)}
                >
                  {run.error_count === 1
                    ? "1 problem, as a file"
                    : `${formatNumber(run.error_count)} problems, as a file`}
                </Button>
              ) : null}
              <Tooltip
                // Disabled with the reason rather than absent: executing is
                // what somebody came to do (§76).
                title={run.can_execute ? "" : whyNotExecute(run)}
              >
                <Button
                  type="primary"
                  size="small"
                  data-testid="execute-import"
                  disabled={!run.can_execute || run.status === "RUNNING"}
                  loading={executing || run.status === "RUNNING"}
                  onClick={onExecute}
                >
                  {run.valid_rows
                    ? `Import ${formatNumber(run.valid_rows)} rows`
                    : "Import"}
                </Button>
              </Tooltip>
            </Space>
          }
        >
          <Counts run={run} />
          {run.status === "RUNNING" ? (
            <Progress percent={99} status="normal" showInfo={false} />
          ) : null}
          <Preview run={run} />
        </Card>
      ) : null}
    </>
  );
}

/** The four counts, side by side, so they can be seen to add up. */
function Counts({ run }: { run: ImportRun }) {
  return (
    <Space className="nu-imp-counts" size={16} data-testid="import-counts">
      <span>
        <Text type="secondary">Ready </Text>
        <Text strong>{formatNumber(run.valid_rows)}</Text>
      </span>
      <span>
        <Text type="secondary">To fix </Text>
        <Text strong type={run.invalid_rows ? "warning" : undefined}>
          {formatNumber(run.invalid_rows)}
        </Text>
      </span>
      <span>
        <Text type="secondary">Nothing mapped </Text>
        <Text strong>{formatNumber(run.skipped_rows)}</Text>
      </span>
      <span>
        <Text type="secondary">of </Text>
        <Text strong>{formatNumber(run.total_rows)}</Text>
        <Text type="secondary"> rows</Text>
      </span>
    </Space>
  );
}

/** The rows as the file has them, with each row's problems on the row. */
function Preview({ run }: { run: ImportDetail }) {
  const columns: ColumnsType<PreviewRow> = [
    {
      title: "Line",
      dataIndex: "line",
      width: 64,
      align: "right",
      // The file's own line, so a reader can find it in the spreadsheet.
      render: (line: number) => <Text className="nu-imp-line">{line}</Text>,
    },
    ...run.detected_columns.map((column) => ({
      title: column.name,
      key: column.name,
      ellipsis: true,
      render: (_value: unknown, row: PreviewRow) => {
        const problem = row.problems.find((item) => item.column === column.name);
        const text = row.source[column.name] ?? "";
        return (
          <span className={problem ? "nu-imp-cell is-wrong" : "nu-imp-cell"}>
            {text || <Text type="secondary">—</Text>}
            {problem ? (
              <Text type="danger" className="nu-imp-why">
                {problem.message}
              </Text>
            ) : null}
          </span>
        );
      },
    })),
  ];

  if (!run.preview.length) {
    return (
      <Empty
        image={null}
        description="This import is no longer holding the file — the rows have become records."
      />
    );
  }

  return (
    <>
      <Table<PreviewRow>
        className="nu-imp-table"
        data-testid="preview-table"
        rowKey="line"
        size="small"
        dataSource={run.preview}
        columns={columns}
        pagination={false}
        rowClassName={(row) => (row.problems.length ? "nu-imp-row is-wrong" : "")}
        scroll={{ x: "max-content" }}
      />
      {run.preview_total > run.preview.length ? (
        <Paragraph type="secondary" className="nu-imp-more" data-testid="preview-more">
          Showing the first {run.preview.length} of {formatNumber(run.preview_total)} rows.
          Every row was checked; the counts above are of all of them.
        </Paragraph>
      ) : null}
    </>
  );
}

/** Earlier imports, so a draft can be picked up and a result looked at. */
function History({
  rows,
  onOpen,
  onDiscard,
}: {
  rows: ImportRun[];
  onOpen: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const columns: ColumnsType<ImportRun> = [
    {
      title: "Reference",
      dataIndex: "reference",
      width: 120,
      render: (value: string, row) => (
        <Button
          type="link"
          className="nu-imp-open"
          data-testid={`imp-${value}`}
          onClick={() => onOpen(row.id)}
        >
          {value}
        </Button>
      ),
    },
    { title: "File", dataIndex: "filename", ellipsis: true },
    { title: "Into", dataIndex: "target_label", width: 130 },
    {
      title: "Where it stands",
      dataIndex: "status",
      width: 300,
      render: (_value, row) => (
        <Space size={6}>
          <Tag color={tone(row)} bordered={false}>
            {STATUS_LABELS[row.status]}
          </Tag>
          <Text type={tone(row) === "error" ? "danger" : "secondary"}>{outcome(row)}</Text>
        </Space>
      ),
    },
    {
      title: "Started",
      dataIndex: "created_at",
      width: 110,
      render: (value: string | null) => (
        <Tooltip title={absoluteTime(value)}>
          <span>{relativeTime(value)}</span>
        </Tooltip>
      ),
    },
    {
      title: "",
      width: 96,
      align: "right",
      render: (_value, row) =>
        row.can_discard ? (
          <Popconfirm
            title={row.holds_file ? "Discard this import?" : "Remove this record?"}
            description={
              row.holds_file
                ? "The file is dropped. The record of having tried is kept."
                : "The import leaves your list. What you tried and when stays in the audit trail."
            }
            okText={row.holds_file ? "Discard it" : "Remove it"}
            cancelText="Keep it"
            onConfirm={() => onDiscard(row.id)}
          >
            <Button size="small" type="text" data-testid={`discard-${row.reference}`}>
              {row.holds_file ? "Discard" : "Remove"}
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <Table<ImportRun>
      rowKey="id"
      size="small"
      dataSource={rows}
      columns={columns}
      pagination={false}
      locale={{
        emptyText: (
          <Empty
            image={null}
            description="Nothing imported yet. A drafted import stays here until you finish or discard it."
          />
        ),
      }}
    />
  );
}

/** Why the execute is refused, in the words the tooltip shows. */
export function whyNotExecute(run: ImportRun): string {
  if (run.unmapped_required.length) {
    return `Choose a column for ${run.unmapped_required.join(", ")} first.`;
  }
  if (run.status === "DRAFT") return "Check the rows first.";
  if (run.status === "RUNNING") return "This import is running.";
  if (run.status === "COMPLETED") return "This file has already been imported.";
  if (run.valid_rows <= 0) {
    return "No row in this file is valid, so there is nothing to import.";
  }
  return "";
}

function fieldLabel(target: ImportTarget, name: string): string {
  return target.fields.find((field) => field.name === name)?.label ?? name;
}

/** The header's one sentence: what this page does and what it will not take. */
function summary(catalogue: ImportCatalogue | undefined): string {
  if (!catalogue) return "Load records from a spreadsheet.";
  const datasets = catalogue.targets.length;
  return `Load records from a CSV into any of ${datasets} datasets. Up to ${formatNumber(
    catalogue.max_rows,
  )} rows, checked row by row before anything is written.`;
}
