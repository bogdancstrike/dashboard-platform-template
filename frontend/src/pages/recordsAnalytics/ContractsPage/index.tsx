/**
 * Contracts and the renewals pipeline (§13).
 *
 * Four views of one set of contracts, the view in the address (`?view=`):
 * the **board** — a column per stage, dragged between (`useBoardDrag`, so
 * pointer, touch and keyboard all work); the **list**; the **forecast** —
 * renewal ARR per quarter, weighted by probability; and the **calendar** of
 * end dates and notice deadlines. Contracts whose customer's health is at
 * risk or critical carry the flag everywhere.
 */
import "@/styles/records-analytics.css";

import { Button, Input, Segmented } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { usePageCommands } from "@/commands/CommandContext";
import { ContractForm } from "@/components/recordsAnalytics/ContractForm";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/auth/AuthProvider";

import { ContractTable } from "./ContractTable";
import { Forecast } from "./Forecast";
import { PipelineBoard } from "./PipelineBoard";
import { RenewalCalendar } from "./RenewalCalendar";
import { VIEWS } from "./contractWords";

export default function ContractsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((v) => v.value === params.get("view"))?.value ?? "board");
  const q = params.get("q") ?? "";
  const atRisk = params.get("at_risk") === "1";
  const creating = useUrlOverlay("contract");
  const { can } = useAuth();
  const canManage = can("contracts.manage");

  const set = (key: string, value: string | null, push = false) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: !push });
  };

  const filters = { q: q || undefined, at_risk: atRisk ? "true" : undefined };

  usePageCommands("contracts", [
    { id: "contracts.new", label: "New contract", keywords: "renewal create", run: () => creating.open("new") },
    { id: "contracts.forecast", label: "Show the renewal forecast", keywords: "quarter arr", run: () => set("view", "forecast", true) },
  ]);

  return (
    <div data-testid="contracts-page">
      <PageHeader
        title={<>Contracts & <em>renewals</em></>}
        subtitle="Every customer agreement worked as a renewal — value, stage, probability and the customer's health beside it."
        actions={
          canManage && (
            <Button type="primary" icon={<NxIcon name="plus" />} onClick={() => creating.open("new")} data-testid="contract-new">
              New contract
            </Button>
          )
        }
      />
      <div className="nx-ra-chips">
        <Segmented
          value={view}
          onChange={(value) => set("view", value === "board" ? null : String(value), true)}
          options={VIEWS}
          aria-label="Contract views"
        />
        <Input.Search
          allowClear
          defaultValue={q}
          placeholder="Contract, reference or customer"
          onSearch={(value) => set("q", value || null)}
          style={{ maxWidth: 280 }}
          aria-label="Search contracts"
        />
        <button type="button" className="nx-ra-chip" aria-pressed={atRisk} onClick={() => set("at_risk", atRisk ? null : "1")}>
          At risk only
        </button>
      </div>

      {view === "board" && <PipelineBoard filters={filters} canManage={canManage} onOpen={(id) => navigate(`/contracts/${id}`)} />}
      {view === "list" && <ContractTable filters={filters} onOpen={(id) => navigate(`/contracts/${id}`)} />}
      {view === "forecast" && <Forecast />}
      {view === "calendar" && <RenewalCalendar filters={filters} onOpen={(id) => navigate(`/contracts/${id}`)} />}

      <ContractForm open={creating.value === "new"} onClose={creating.close} onSaved={(saved) => navigate(`/contracts/${saved.id}`, { replace: true })} />
    </div>
  );
}
