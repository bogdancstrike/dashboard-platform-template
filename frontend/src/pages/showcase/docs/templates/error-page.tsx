import { ApiError } from "@/api/client";
import { FailureAlert } from "@/components/FailureAlert";
import { PageHeader } from "@/components/PageHeader";

export default function ErrorPageTemplate() {
  return (
    <div className="nx-ad">
      <PageHeader title="Orders" subtitle="The ledger, newest first" />
      <FailureAlert
        error={new ApiError(500, { error: "demo", message: "The database did not answer in time." }, "b7f2c1a9-demo")}
        titles={{ failed: "The orders could not be loaded" }}
        onRetry={() => undefined}
      />
    </div>
  );
}
