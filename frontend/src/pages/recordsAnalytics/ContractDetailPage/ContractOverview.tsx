import { Progress } from "antd";
import { Link } from "react-router-dom";

import { money, type ContractDetail } from "@/api/recordsAnalytics";
import { PanelHeader } from "@/components/layout/PanelHeader";
import { BandPill } from "@/components/recordsAnalytics/parts";
import { absoluteTime } from "@/lib/time";

import { riskFlag } from "../ContractsPage/contractWords";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="nx-ra-fact">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

/** The contract's terms, and what the customer's health means for this renewal. */
export function ContractOverview({ data }: { data: ContractDetail }) {
  return (
    <div className="nx-ra-grid nx-ra-grid--2">
      <section className="nx-ra-panel">
        <PanelHeader title="Terms" extra={riskFlag(data)} />
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
        <PanelHeader title="Customer health" />
        <p style={{ margin: "0 0 10px" }}><BandPill band={data.health_band} score={data.health_score} /></p>
        <p className="nx-ra-sub" style={{ margin: 0 }}>
          {data.at_risk
            ? "The customer's health is low while this renewal is open — it is flagged at risk on the pipeline."
            : "Nothing in the customer's health threatens this renewal."}
        </p>
        <Link to={`/customers/${data.customer.id}?tab=health`}>See why →</Link>
      </section>
    </div>
  );
}
