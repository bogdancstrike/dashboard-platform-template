import { Button, Steps } from "antd";
import { useState } from "react";

const STEPS = ["File", "Columns", "Check", "Done"];

export default function StepsWizard() {
  const [current, setCurrent] = useState(1);
  return (
    <div className="nx-doc-col">
      <Steps size="small" current={current} items={STEPS.map((title) => ({ title }))} />
      <div className="nx-doc-row">
        <Button disabled={current === 0} onClick={() => setCurrent(current - 1)}>
          Back
        </Button>
        <Button type="primary" disabled={current === STEPS.length - 1} onClick={() => setCurrent(current + 1)}>
          Continue
        </Button>
      </div>
    </div>
  );
}
