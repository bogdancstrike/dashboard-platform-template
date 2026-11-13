/**
 * One contract (§13): its terms and dates, where it is in the renewal
 * pipeline (each step a button that moves it), its customer's health, its
 * documents, and its full history — versions that can be compared and
 * restored like any record's (§17).
 */
import "@/styles/records-analytics.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Modal, Skeleton, Tabs } from "antd";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { useSmartBack } from "@/app/history";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { useAuth } from "@/auth/AuthProvider";
import { contractsApi, STAGE_LABEL, STAGE_ORDER, type ContractStage } from "@/api/recordsAnalytics";
import { ContractForm } from "@/components/recordsAnalytics/ContractForm";
import { VersionHistory } from "@/components/recordsAnalytics/VersionHistory";
import { FailureAlert } from "@/components/FailureAlert";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { StatusTag } from "@/components/StatusTag";
import { usePageCommands } from "@/commands/CommandContext";
import { errorToast } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";
import { relativeTime } from "@/lib/time";

import { ContractFiles, useContractFiles } from "./ContractFiles";
import { ContractOverview } from "./ContractOverview";

export default function ContractDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const back = useSmartBack();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const editing = useUrlOverlay("edit");
  const client = useQueryClient();
  const { message } = App.useApp();
  const { can } = useAuth();

  const contract = useQuery({ queryKey: queryKeys.contract(id), queryFn: ({ signal }) => contractsApi.get(id, signal), enabled: Boolean(id) });
  const { files, upload } = useContractFiles(id);

  const move = useMutation({
    mutationFn: (stage: ContractStage) => contractsApi.move(id, { stage }),
    onSuccess: (saved) => {
      client.setQueryData(queryKeys.contract(id), saved);
      void client.invalidateQueries({ queryKey: queryKeys.contracts() });
      void client.invalidateQueries({ queryKey: queryKeys.recordVersions("contract", id) });
      void message.success(`Moved to ${STAGE_LABEL[saved.stage]}.`);
    },
    onError: errorToast(message, { action: "move contracts" }),
  });
  const remove = useMutation({
    mutationFn: () => contractsApi.remove(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.contracts() });
      navigate("/contracts", { replace: true });
    },
    onError: errorToast(message, { action: "delete contracts" }),
  });

  usePageCommands(`contract:${id}`, [
    { id: "contract.edit", label: "Edit this contract", keywords: "change", run: () => editing.open("1") },
    { id: "contract.history", label: "Show this contract's versions", keywords: "history restore", run: () => setTab("history") },
  ]);

  function setTab(key: string) {
    const next = new URLSearchParams(params);
    if (key === "overview") next.delete("tab");
    else next.set("tab", key);
    setParams(next);
  }

  if (contract.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (contract.isError) {
    return (
      <>
        <PageHeader title="Contract" onBack={() => back("/contracts")} />
        <FailureAlert error={contract.error} titles={{ not_found: "No contract at this address" }} onRetry={() => void contract.refetch()} />
      </>
    );
  }
  const data = contract.data!;
  const canEdit = data.can_edit;
  const position = STAGE_ORDER.indexOf(data.stage);

  return (
    <div data-testid="contract-detail">
      <PageHeader
        title={data.title}
        onBack={() => back("/contracts")}
        subtitle={
          <span>
            {data.reference} · {data.customer.name} · owner {data.owner.name ?? "nobody"} · updated {relativeTime(data.updated_at)}
          </span>
        }
        tag={<StatusTag status={data.stage} label={data.stage_label} />}
        actions={
          <>
            <Button onClick={() => navigate(`/customers/${data.customer.id}?tab=health`)} icon={<NxIcon name="store" />}>
              Customer
            </Button>
            {canEdit && (
              <>
                <Button
                  danger
                  onClick={() =>
                    Modal.confirm({
                      title: `Delete ${data.reference}?`,
                      content: "It disappears from the pipeline; the audit trail keeps it.",
                      okText: "Delete",
                      okButtonProps: { danger: true },
                      onOk: () => remove.mutateAsync(),
                    })
                  }
                >
                  Delete
                </Button>
                <Button type="primary" icon={<NxIcon name="pen" />} onClick={() => editing.open("1")} data-testid="contract-edit">
                  Edit
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="nx-ra-stepper" role="group" aria-label="Renewal stage">
        {STAGE_ORDER.map((stage, index) => (
          <button
            key={stage}
            type="button"
            className={`nx-ra-step${stage === data.stage ? " is-current" : index < position && position < 3 ? " is-done" : ""}`}
            disabled={!canEdit || stage === data.stage || move.isPending}
            onClick={() => move.mutate(stage)}
            aria-current={stage === data.stage ? "step" : undefined}
          >
            {STAGE_LABEL[stage]}
          </button>
        ))}
      </div>

      <Tabs
        className="nx-rec-tabs"
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "overview",
            label: "Overview",
            children: (
              <ContractOverview data={data} />
            ),
          },
          {
            key: "files",
            label: "Files",
            children: (
              <ContractFiles files={files} upload={upload} />
            ),
          },
          {
            key: "history",
            label: "History",
            children: (
              <section className="nx-ra-panel">
                <VersionHistory resourceType="contract" recordId={id} onRestored={() => void contract.refetch()} />
              </section>
            ),
          },
        ]}
      />
      {can("contracts.manage") && (
        <ContractForm open={editing.value === "1"} onClose={editing.close} contract={data} />
      )}
    </div>
  );
}
