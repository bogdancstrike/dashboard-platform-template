/**
 * `/reports` — the questions worth asking again (§28).
 *
 * A report is a saved analysis, so this page is a list of questions and one
 * answer: pick a report on the left, read its result on the right. That shape
 * is deliberate — a gallery of report *names* makes somebody click through
 * five of them to find the one they meant, and a page that runs all of them
 * runs five aggregate queries to show one.
 *
 * The answer is computed by the same compiler the analytics workspace uses, so
 * a report and the screen it was built on cannot disagree about the same data.
 * The result is drawn with the platform's own chart renderer, which means it
 * is also readable as a table and exportable as CSV without anything here
 * knowing how either works (§30).
 *
 * Sharing is the saved-search model, and the page says which of the three
 * states a report is in rather than leaving the reader to guess who else can
 * see it.
 */

import { Alert, Button, Skeleton } from "antd";

import { ApiError } from "@/api/client";
import { AddToDashboard } from "@/components/dashboards/AddToDashboard";
import { PageHeader } from "@/components/PageHeader";
import { apiErrorDetails } from "@/components/feedback/apiErrorDetails";

import { ReportDetail } from "./parts/ReportDetail";
import { ReportList } from "./parts/ReportList";
import { ReportsHeader } from "./parts/ReportsHeader";
import { useReportsPage } from "./useReportsPage";

export default function ReportsPage() {
  const page = useReportsPage();
  const { pinning, setPinning, reports } = page;
  if (reports.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (reports.isError) {
    const error = reports.error;
    return (
      <>
        <PageHeader title="Reports" />
        <Alert
          type={error instanceof ApiError && error.isForbidden ? "warning" : "error"}
          showIcon
          message={error instanceof ApiError ? error.message : "Reports could not be loaded."}
          description={apiErrorDetails(error, 2)}
          action={<Button onClick={() => void reports.refetch()}>Retry</Button>}
        />
      </>
    );
  }

  return (
    <>
      <ReportsHeader page={page} />

      {/* A workbench: the questions on the left, the answer on the right,
          filling the window. Sized to its content, the answer left a third of
          the screen blank under it and the list was capped at two thirds of
          the viewport whether or not there was room. */}
      <div className="nx-ov-reports" data-testid="reports">
        <ReportList page={page} />

        <ReportDetail page={page} />
      </div>

      <AddToDashboard open={pinning !== null} subject={pinning} onClose={() => setPinning(null)} />
    </>
  );
}
