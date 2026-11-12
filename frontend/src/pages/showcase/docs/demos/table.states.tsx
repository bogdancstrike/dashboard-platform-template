import { Button, Segmented, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { EmptyState, NoResults } from "@/components/EmptyState";
import { FailureAlert } from "@/components/FailureAlert";
import { StatusTag } from "@/components/StatusTag";

const ROWS = [
  { id: "1", reference: "TIC-00041", title: "Printer on fire", status: "OPEN" },
  { id: "2", reference: "TIC-00042", title: "Export finishes empty", status: "IN_PROGRESS" },
];

const COLUMNS: ColumnsType<(typeof ROWS)[number]> = [
  { title: "Reference", dataIndex: "reference", width: 130 },
  { title: "Title", dataIndex: "title" },
  { title: "Status", dataIndex: "status", width: 140, render: (value: string) => <StatusTag status={value} /> },
];

const STATES = [
  { value: "rows", label: "Rows" },
  { value: "loading", label: "Loading" },
  { value: "nothing", label: "Nothing yet" },
  { value: "no-match", label: "Nothing matched" },
  { value: "error", label: "Failed" },
  { value: "forbidden", label: "Refused" },
];

export default function TableStates() {
  const [state, setState] = useState("rows");
  const failed = state === "error" || state === "forbidden";
  return (
    <div className="nx-doc-col">
      <Segmented aria-label="Table state" value={state} onChange={(value) => setState(String(value))} options={STATES} />
      <div data-testid="table-stage">
        {failed ? (
          <FailureAlert
            error={
              new ApiError(
                state === "error" ? 500 : 403,
                {
                  error: "demo",
                  message: "The server's own sentence about what happened.",
                  details: state === "forbidden" ? { missing: ["records.view"] } : {},
                },
                "b7f2c1a9-demo",
              )
            }
            titles={{ failed: "Those records could not be loaded", forbidden: "Your role does not include this dataset" }}
            onRetry={() => undefined}
          />
        ) : (
          <Table
            rowKey="id"
            size="small"
            loading={state === "loading"}
            dataSource={state === "rows" ? ROWS : []}
            columns={COLUMNS}
            pagination={false}
            scroll={{ x: 520 }}
            locale={{
              emptyText:
                state === "loading" ? (
                  <> </>
                ) : state === "no-match" ? (
                  <NoResults filterCount={2} onClear={() => undefined} />
                ) : (
                  <EmptyState
                    title="No tickets yet"
                    hint="A ticket is a customer's problem with a deadline attached."
                    action={<Button type="primary">New ticket</Button>}
                  />
                ),
            }}
          />
        )}
      </div>
    </div>
  );
}
