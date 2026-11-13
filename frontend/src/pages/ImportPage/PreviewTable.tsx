import { Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { ImportDetail, PreviewRow } from "@/api/imports";
import { EmptyState } from "@/components/EmptyState";
import { formatNumber } from "@/lib/formats";

const { Text, Paragraph } = Typography;

/** The rows as the file has them, with each row's problems on the row. */
export function PreviewTable({ run }: { run: ImportDetail }) {
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
      <EmptyState title="This import is no longer holding the file — the rows have become records." />
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
