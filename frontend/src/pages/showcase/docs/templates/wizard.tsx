import { Button, Card, Select, Steps } from "antd";
import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";

const STEPS = ["File", "Columns", "Check", "Done"];

export default function WizardTemplate() {
  const [step, setStep] = useState(1);
  return (
    <div className="nx-ad">
      <PageHeader
        title="Import"
        subtitle={`customers-nov.csv · step ${step + 1} of ${STEPS.length}`}
        actions={
          <>
            <Button disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
            <Button type="primary" disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)}>Continue</Button>
          </>
        }
      />
      <Steps size="small" current={step} items={STEPS.map((title) => ({ title }))} />
      <Card title="Match your columns to Customer fields">
        {["company_name", "vat_id", "segment"].map((column) => (
          <div key={column} className="nx-doc-row" style={{ justifyContent: "space-between", padding: "6px 0" }}>
            <code>{column}</code>
            <Select aria-label={`Field for ${column}`} placeholder="Choose a field…" style={{ minWidth: 220 }} options={[]} />
          </div>
        ))}
      </Card>
    </div>
  );
}
