import { FailureAlert } from "@/components/FailureAlert";

import { AlertStrip } from "./parts/AlertStrip";
import { ChartGrid } from "./parts/ChartGrid";
import { DashboardHeader } from "./parts/DashboardHeader";
import { KpiGrid } from "./parts/KpiGrid";
import { QuietPanels } from "./parts/QuietPanels";
import { useDashboardPage } from "./useDashboardPage";

export default function DashboardPage() {
  const page = useDashboardPage();
  const { isError, error, refetch } = page;

  return (
    <>
      <DashboardHeader page={page} />

      {isError && (
        <FailureAlert
          className="nu-block"
          error={error}
          titles={{
            forbidden: "Your role does not include the dashboard",
            failed: "The dashboard could not be loaded",
          }}
          onRetry={() => void refetch()}
        />
      )}

      <AlertStrip page={page} />

      <KpiGrid page={page} />

      <ChartGrid page={page} />

      <QuietPanels page={page} />
    </>
  );
}
