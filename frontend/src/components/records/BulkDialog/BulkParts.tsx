import { Alert, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { BulkFailure } from "@/api/bulk";
import { bulkApi } from "@/api/bulk";
import type { ExplorerResource } from "@/api/explorer";
import { formatNumber } from "@/lib/formats";

const { Text } = Typography;

/** The §75 half: how many, which, and what will be left alone. */
export function Consequences({
  found,
  resource,
}: {
  found: NonNullable<Awaited<ReturnType<typeof bulkApi.preview>>>;
  resource: ExplorerResource | undefined;
}) {
  return (
    <div className="nu-bulk-preview" data-testid="bulk-preview">
      <Text strong>{found.describes}</Text>
      {found.by_filter > 0 && found.by_hand > 0 && (
        // The split, spelled out. Somebody who ticked twelve boxes knows what
        // is in them; somebody who filtered does not, and one total hides
        // which of the two they are about to act on.
        <div className="nu-bulk-split">
          <Tag>{formatNumber(found.by_hand)} selected by hand</Tag>
          <Tag>{formatNumber(found.by_filter)} matched by the filter</Tag>
        </div>
      )}

      {found.sample.length > 0 && (
        <div className="nu-bulk-sample">
          <Text type="secondary">Including</Text>
          <ul>
            {found.sample.map((entry) => (
              <li key={entry.id}>{entry.title}</li>
            ))}
          </ul>
        </div>
      )}

      {found.refused.map((refusal) => (
        <Alert
          key={refusal.reason}
          type="warning"
          showIcon
          className="nu-bulk-refusal"
          message={`${formatNumber(refusal.count)} will be left alone — ${refusal.reason.toLowerCase()}`}
        />
      ))}

      {found.over_limit && (
        <Alert
          type="error"
          showIcon
          data-testid="bulk-over-limit"
          message={`That is more than ${formatNumber(found.limit)} ${(resource?.label ?? "records").toLowerCase()}`}
          description="Narrow the filter and try again. One action is capped so that a wrong filter is a mistake somebody notices rather than a restore."
        />
      )}

      {!found.over_limit && found.eligible === 0 && (
        <Alert
          type="info"
          showIcon
          message="Nothing here would change"
          description="Every selected record is already as you are asking for it to be."
        />
      )}
    </div>
  );
}

/** Both halves of what happened, because both are normal. */
export function Outcome({
  result,
  resource,
}: {
  result: NonNullable<Awaited<ReturnType<typeof bulkApi.apply>>>;
  resource: ExplorerResource | undefined;
}) {
  const columns: ColumnsType<BulkFailure> = [
    { title: (resource?.label ?? "Record").replace(/s$/, ""), dataIndex: "title" },
    { title: "Why not", dataIndex: "message" },
  ];

  return (
    <div className="nu-bulk-body" data-testid="bulk-result">
      <Alert
        type={result.failed.length > 0 ? "warning" : "success"}
        showIcon
        message={result.message}
      />
      {result.failed.length > 0 && (
        <>
          <Text type="secondary">
            The rest were applied. A refusal on one record does not undo the others.
          </Text>
          <Table<BulkFailure>
            rowKey="id"
            size="small"
            pagination={false}
            columns={columns}
            dataSource={result.failed}
            data-testid="bulk-failures"
          />
        </>
      )}
    </div>
  );
}
