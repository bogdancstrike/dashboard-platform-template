import { Alert, Button } from "antd";

export default function AlertTones() {
  return (
    <div className="nx-doc-col">
      <Alert type="info" showIcon message="Changes apply on the holder's next request" />
      <Alert type="success" showIcon message="Import finished — 1,408 rows written" />
      <Alert
        type="warning"
        showIcon
        message="1 setting needs a restart to take effect"
        description="It is stored, and the running process is still using the old value."
      />
      <Alert type="error" showIcon message="The ERP sync failed twice" action={<Button>Retry</Button>} closable />
    </div>
  );
}
