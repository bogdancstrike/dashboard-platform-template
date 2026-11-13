import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Table } from "antd";

import {
  contractsApi,
  money,
  STAGE_LABEL,
  type ContractCard,
  type ContractStage,
} from "@/api/recordsAnalytics";
import { BandPill } from "@/components/recordsAnalytics/parts";
import { FailureAlert } from "@/components/FailureAlert";
import { StatusTag } from "@/components/StatusTag";
import { queryKeys } from "@/lib/queryKeys";

import { Summary } from "./PipelineBoard";
import { endsIn, riskFlag } from "./contractWords";

export function ContractTable({ filters, onOpen }: { filters: Record<string, string | undefined>; onOpen: (id: string) => void }) {
  const list = useQuery({
    queryKey: queryKeys.contracts("list", filters),
    queryFn: ({ signal }) => contractsApi.list({ ...filters, page_size: 200 }, signal), 
    placeholderData: keepPreviousData,
  });
  if (list.isError) return <FailureAlert error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <>
      {list.data && <Summary board={list.data} />}
      <div className="nx-ra-panel">
        <Table<ContractCard>
          rowKey="id"
          size="middle"
          loading={list.isLoading}
          dataSource={list.data?.items ?? []}
          scroll={{ x: 820 }}
          pagination={{ pageSize: 25, showSizeChanger: false }}
          onRow={(row) => ({ onClick: () => onOpen(row.id), style: { cursor: "pointer" } })}
          columns={[
            { title: "Contract", dataIndex: "reference", render: (_: unknown, row) => (<><b>{row.reference}</b><div className="nx-ra-muted">{row.title}</div></>) },
            { title: "Customer", render: (_: unknown, row) => (<>{row.customer.name} {riskFlag(row)}</>) },
            { title: "Stage", dataIndex: "stage", render: (stage: ContractStage) => <StatusTag status={stage} label={STAGE_LABEL[stage]} /> },
            { title: "Value", dataIndex: "value", align: "right", sorter: (a, b) => a.value - b.value, render: (v: number, row) => money(v, row.currency) },
            { title: "Prob.", dataIndex: "probability", align: "right", render: (v: number) => `${v}%` },
            { title: "Ends", dataIndex: "end_date", sorter: (a, b) => String(a.end_date).localeCompare(String(b.end_date)), render: (v: string, row) => (<>{v}<div className="nx-ra-muted">{endsIn(row.days_to_end)}</div></>) },
            { title: "Health", render: (_: unknown, row) => <BandPill band={row.health_band} score={row.health_score} /> },
            { title: "Owner", render: (_: unknown, row) => row.owner.name ?? "—" },
          ]}
        />
      </div>
    </>
  );
}
