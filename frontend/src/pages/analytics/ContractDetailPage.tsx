/**
 * One contract (§13): its terms and dates, where it is in the renewal
 * pipeline (each step a button that moves it), its customer's health, its
 * documents, and its full history — versions that can be compared and
 * restored like any record's (§17).
 */
import "@/styles/analytics.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Modal, Progress, Skeleton, Tabs, Upload } from "antd";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { useSmartBack } from "@/app/history";
import { useUrlOverlay } from "@/app/useUrlOverlay";
import { useAuth } from "@/auth/AuthProvider";
import { filesApi, putBytes } from "@/api/files";
import { contractsApi, money, STAGE_LABEL, STAGE_ORDER, type ContractStage } from "@/api/recordsAnalytics";
import { ContractForm } from "@/components/analytics/ContractForm";
import { BandPill } from "@/components/analytics/parts";
import { VersionHistory } from "@/components/analytics/VersionHistory";
import { FailureAlert } from "@/components/FailureAlert";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { StatusTag } from "@/components/StatusTag";
import { usePageCommands } from "@/commands/CommandContext";
import { errorText } from "@/lib/errors";
import { absoluteTime, relativeTime } from "@/lib/time";

import { riskFlag } from "./ContractsPage";
import { queryKeys } from "@/lib/queryKeys";

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
  const files = useQuery({
    queryKey: queryKeys.contract(id, "files"),
    queryFn: ({ signal }) => contractsApi.files(id, signal),
    enabled: Boolean(id),
  });

  const move = useMutation({
    mutationFn: (stage: ContractStage) => contractsApi.move(id, { stage }),
    onSuccess: (saved) => {
      client.setQueryData(queryKeys.contract(id), saved);
      void client.invalidateQueries({ queryKey: queryKeys.contracts() });
      void client.invalidateQueries({ queryKey: queryKeys.recordVersions("contract", id) });
      void message.success(`Moved to ${STAGE_LABEL[saved.stage]}.`);
    },
    onError: (error) => void message.error(errorText(error, { action: "move contracts" })),
  });
  const remove = useMutation({
    mutationFn: () => contractsApi.remove(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.contracts() });
      navigate("/contracts", { replace: true });
    },
    onError: (error) => void message.error(errorText(error, { action: "delete contracts" })),
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

  const upload = async (file: File) => {
    try {
      const { folder_id } = await contractsApi.folder(id);
      const ticket = await filesApi.beginUpload({ name: file.name, size_bytes: file.size, mime_type: file.type || undefined, folder_id });
      await putBytes(ticket, file, () => undefined);
      await filesApi.confirmUpload(ticket.file.id);
      void message.success(`${file.name} attached.`);
      void client.invalidateQueries({ queryKey: queryKeys.contract(id, "files") });
    } catch (error) {
      void message.error(errorText(error, { action: "upload files" }));
    }
    return false;
  };

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
              <div className="nx-ra-grid nx-ra-grid--2">
                <section className="nx-ra-panel">
                  <div className="nx-ra-panel-head"><h2>Terms</h2>{riskFlag(data)}</div>
                  <div className="nx-ra-facts-grid">
                    <Fact label="Value (ARR)" value={money(data.value, data.currency)} />
                    <Fact label="Weighted" value={money(data.weighted, data.currency)} />
                    <Fact label="Probability" value={<Progress percent={data.probability} size="small" aria-label={`Probability ${data.probability}%`} style={{ width: 120, margin: 0 }} />} />
                    <Fact label="Billing" value={data.billing.toLowerCase()} />
                    <Fact label="Start" value={data.start_date} />
                    <Fact label="End" value={`${data.end_date} (${data.days_to_end !== null && data.days_to_end >= 0 ? `in ${data.days_to_end} days` : "ended"})`} />
                    <Fact label="Term" value={`${data.term_months} months`} />
                    <Fact label="Notice" value={`${data.notice_days} days — by ${data.notice_by}`} />
                    <Fact label="Auto-renew" value={data.auto_renew ? "Yes" : "No"} />
                    <Fact label="Stage since" value={absoluteTime(data.stage_changed_at)} />
                    {data.churn_reason && <Fact label="Churn reason" value={data.churn_reason} />}
                  </div>
                  {data.terms && (<><h3 className="nx-ra-sub" style={{ marginTop: 14 }}>Terms</h3><p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{data.terms}</p></>)}
                  {data.notes && (<><h3 className="nx-ra-sub" style={{ marginTop: 14 }}>Notes</h3><p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{data.notes}</p></>)}
                </section>
                <section className="nx-ra-panel">
                  <div className="nx-ra-panel-head"><h2>Customer health</h2></div>
                  <p style={{ margin: "0 0 10px" }}><BandPill band={data.health_band} score={data.health_score} /></p>
                  <p className="nx-ra-sub" style={{ margin: 0 }}>
                    {data.at_risk
                      ? "The customer's health is low while this renewal is open — it is flagged at risk on the pipeline."
                      : "Nothing in the customer's health threatens this renewal."}
                  </p>
                  <Link to={`/customers/${data.customer.id}?tab=health`}>See why →</Link>
                </section>
              </div>
            ),
          },
          {
            key: "files",
            label: "Files",
            children: (
              <section className="nx-ra-panel" data-testid="contract-files">
                <div className="nx-ra-panel-head">
                  <h2>Documents</h2>
                  {files.data?.can_upload && (
                    <Upload beforeUpload={(file) => upload(file)} showUploadList={false} multiple>
                      <Button icon={<NxIcon name="import" />}>Attach</Button>
                    </Upload>
                  )}
                </div>
                {files.isError ? <FailureAlert error={files.error} /> : !files.data ? <Skeleton active /> : files.data.items.length === 0 ? (
                  <p className="nx-ra-muted">No documents yet. Signed copies and order forms belong here.</p>
                ) : (
                  <ul className="nx-ra-rows">
                    {files.data.items.map((file) => (
                      <li key={file.id} className="nx-ra-row" onClick={() => navigate(`/files?folder=${files.data.folder_id}&file=${file.id}`)}>
                        <NxIcon name="folder" />
                        <div className="nx-ra-row-main">
                          <b>{file.name}</b>
                          <span>{Math.max(1, Math.round(file.size_bytes / 1024))} KB · {file.owner ?? "—"} · {relativeTime(file.created_at)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
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

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="nx-ra-fact">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
