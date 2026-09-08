import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import JobsPage, { formatDuration, progressLabel, toneFor, whyNot } from "@/pages/admin/JobsPage";
import type { Job } from "@/api/jobs";
import { CommandProvider } from "@/commands/CommandContext";
import { currentUser, jobRows, resetJobs, setJobsCanManage } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * The background job queue (§23).
 *
 * `whyNot` carries this page, so it is stated exactly: the whole §76 rule here
 * is that a refused control says *which* refusal it is, and the two reasons a
 * retry is unavailable are different problems with different fixes. The rest is
 * asserted through the page, because the behaviours that matter are the writes
 * and the refusals.
 */
function render(route = "/admin/jobs") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/admin/jobs" element={<JobsPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

function withPermissions(...extra: string[]) {
  server.use(
    http.get("/platform/api/me", () =>
      HttpResponse.json({
        ...currentUser,
        permissions: [...currentUser.permissions, "jobs.view", ...extra],
      }),
    ),
  );
}

afterEach(() => {
  resetJobs();
  setJobsCanManage(true);
});

const asJob = (overrides: Partial<Job>): Job =>
  ({
    status: "FAILED",
    // A kind this console owns, so a case that does not say otherwise is
    // testing the status and attempt rules rather than the kind rule (§30).
    kind: "REPORT",
    attempt: 1,
    max_attempts: 3,
    can_retry: true,
    can_cancel: false,
    can_allow_attempts: false,
    ...overrides,
  }) as Job;

describe("why a control is unavailable", () => {
  it("says nothing when the action is allowed", () => {
    expect(whyNot(asJob({ can_retry: true }), "retry")).toBeNull();
    expect(whyNot(asJob({ can_cancel: true }), "cancel")).toBeNull();
  });

  it("distinguishes 'still running' from 'out of attempts'", () => {
    // The whole point. A shared "not allowed" would have told an operator
    // neither thing, and the fixes are different: wait, versus raise the limit.
    expect(whyNot(asJob({ status: "RUNNING", can_retry: false }), "retry")).toContain(
      "has not finished",
    );
    expect(
      whyNot(asJob({ status: "FAILED", attempt: 3, max_attempts: 3, can_retry: false }), "retry"),
    ).toContain("All 3 attempts");
  });

  it("sends an export to the page that owns it, whatever its attempts say", () => {
    // Two screens must not give opposite answers about the same row: `/exports`
    // re-requests rather than retries, because the rows have moved on. Checked
    // *before* the attempt count, or somebody would be told to grant more
    // attempts — a fix that would change nothing here.
    const answer = whyNot(
      asJob({ kind: "EXPORT", status: "CANCELLED", can_retry: false }),
      "retry",
    );
    expect(answer).toContain("re-requested rather than retried");
    expect(answer).toContain("Exports page");

    // Even out of attempts, the kind is still the reason to give.
    expect(
      whyNot(
        asJob({
          kind: "EXPORT",
          attempt: 3,
          max_attempts: 3,
          can_retry: false,
          can_allow_attempts: true,
        }),
        "retry",
      ),
    ).toContain("re-requested");
  });

  it("points at the grant when one is possible, and does not when it is not", () => {
    // The refusal used to say "raise the limit" with no way to raise it — an
    // error message naming a fix the product did not offer. Now it says one
    // thing when the grant exists and another when the ceiling is reached.
    expect(
      whyNot(
        asJob({ attempt: 3, max_attempts: 3, can_retry: false, can_allow_attempts: true }),
        "retry",
      ),
    ).toContain("Grant it more");
    expect(
      whyNot(
        asJob({ attempt: 10, max_attempts: 10, can_retry: false, can_allow_attempts: false }),
        "retry",
      ),
    ).toContain("most one job may be granted");
  });

  it("names the state when there is nothing left to cancel", () => {
    expect(whyNot(asJob({ status: "SUCCEEDED", can_cancel: false }), "cancel")).toContain(
      "succeeded",
    );
  });

  it("explains why retrying a running job would be wrong, not merely that it is", () => {
    // "Would run it twice over the same records" is the fact that makes the
    // refusal reasonable rather than arbitrary.
    expect(whyNot(asJob({ status: "RUNNING", can_retry: false }), "retry")).toContain("twice");
  });
});

describe("how a job reads", () => {
  it("gives retrying its own tone, distinct from failed", () => {
    // "Failed and will be tried again" should not pull an operator's eye like
    // "failed and will not".
    expect(toneFor("FAILED")).toBe("error");
    expect(toneFor("RETRYING")).toBe("warning");
    expect(toneFor("SUCCEEDED")).toBe("success");
    expect(toneFor("RUNNING")).toBe("processing");
  });

  it("says the units, not just a percentage", () => {
    expect(progressLabel(asJob({ total_units: 100, processed_units: 40, failed_units: 0 }))).toBe(
      "40 of 100",
    );
    // A partial failure is the number that matters most, so it is said.
    expect(progressLabel(asJob({ total_units: 100, processed_units: 40, failed_units: 60 }))).toBe(
      "40 of 100, 60 failed",
    );
    // Nothing to count against: fall back to the percentage rather than "0 of 0".
    expect(progressLabel(asJob({ total_units: 0, progress: 55 }))).toBe("55%");
  });

  it("scales a duration to the unit that stays readable", () => {
    expect(formatDuration(420)).toBe("420 ms");
    expect(formatDuration(4200)).toBe("4.2 s");
    expect(formatDuration(91_000)).toBe("2 min");
    expect(formatDuration(5_400_000)).toBe("1.5 h");
  });
});

describe("the queue", () => {
  it("lists the jobs with their status and attempts", async () => {
    withPermissions("jobs.manage");
    render();

    const table = await screen.findByTestId("jobs-table");
    await waitFor(() => expect(within(table).getByText("Export — orders")).toBeInTheDocument());

    expect(within(table).getByText("Import — customers")).toBeInTheDocument();
    // The spent job's attempt count is on the face of the row.
    expect(within(table).getByText("attempt 3 of 3")).toBeInTheDocument();
  });

  it("offers every status, and refuses the empty ones (§76)", async () => {
    withPermissions();
    render();

    const strip = await screen.findByTestId("job-statuses");
    for (const status of ["QUEUED", "RUNNING", "RETRYING", "SUCCEEDED", "FAILED", "CANCELLED"]) {
      expect(within(strip).getByTestId(`job-status-${status}`)).toBeInTheDocument();
    }
    // The fixture has no cancelled job: offered, and disabled, so the reader
    // learns the status exists and that nothing is in it.
    expect(within(strip).getByTestId("job-status-CANCELLED")).toBeDisabled();
    expect(within(strip).getByTestId("job-status-FAILED")).toBeEnabled();
  });

  it("narrows to a status and leaves the counts alone (§71)", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const strip = await screen.findByTestId("job-statuses");
    const before = within(strip).getByTestId("job-status-FAILED").textContent;

    await user.click(within(strip).getByTestId("job-status-FAILED"));

    const table = await screen.findByTestId("jobs-table");
    await waitFor(() =>
      expect(within(table).queryByText("Reindex — search")).not.toBeInTheDocument(),
    );
    // The strip still describes the whole queue, not what is on screen.
    expect(within(strip).getByTestId("job-status-FAILED").textContent).toBe(before);
  });

  it("keeps the question in the address (§69)", async () => {
    withPermissions();
    render("/admin/jobs?status=RUNNING");

    const strip = await screen.findByTestId("job-statuses");
    expect(within(strip).getByTestId("job-status-RUNNING")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const table = await screen.findByTestId("jobs-table");
    await waitFor(() =>
      expect(within(table).queryByText("Export — orders")).not.toBeInTheDocument(),
    );
  });

  it("finds a job by the error it reported", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("jobs-table");
    await user.type(screen.getByLabelText("Search the queue"), "mail relay");

    await waitFor(() => expect(screen.queryByText("Export — orders")).not.toBeInTheDocument());
    expect(screen.getByText("Email — digest")).toBeInTheDocument();
  });
});

describe("what may be done to a job", () => {
  it("offers Retry on a failure within its attempts", async () => {
    withPermissions("jobs.manage");
    render();

    await screen.findByTestId("jobs-table");
    expect(await screen.findByTestId("retry-JOB-000101")).toBeEnabled();
  });

  it("refuses Retry on a job that has used its attempts, and says so", async () => {
    withPermissions("jobs.manage");
    render();

    await screen.findByTestId("jobs-table");
    // Disabled rather than absent: retrying *is* something an operator does,
    // and the reason is the actionable part (§76).
    const spent = await screen.findByTestId("retry-JOB-000102");
    expect(spent).toBeDisabled();
  });

  it("refuses Retry while a job is running, and Cancel once it has finished", async () => {
    withPermissions("jobs.manage");
    render();

    await screen.findByTestId("jobs-table");
    expect(await screen.findByTestId("retry-JOB-000103")).toBeDisabled();
    expect(screen.getByTestId("cancel-JOB-000103")).toBeEnabled();
    // And the other way round for the one that succeeded.
    expect(screen.getByTestId("retry-JOB-000104")).toBeEnabled();
    expect(screen.getByTestId("cancel-JOB-000104")).toBeDisabled();
  });

  it("queues another attempt on the same job", async () => {
    withPermissions("jobs.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("jobs-table");
    await user.click(await screen.findByTestId("retry-JOB-000101"));
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() => {
      const row = jobRows.find((item) => item["id"] === "job-failed");
      expect(row?.["attempt"]).toBe(2);
      expect(row?.["status"]).toBe("QUEUED");
    });
  });

  it("says which attempt it queued, because that is the useful part", async () => {
    withPermissions("jobs.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("jobs-table");
    await user.click(await screen.findByTestId("retry-JOB-000101"));
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    // The toast, specifically — the confirmation's own description also says
    // "attempt 2 of 3", which is the point of saying it before *and* after.
    expect(await screen.findByText(/is queued again/)).toBeInTheDocument();
  });

  it("stops a running job and keeps it in the queue", async () => {
    withPermissions("jobs.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("jobs-table");
    await user.click(await screen.findByTestId("cancel-JOB-000103"));
    // "Stop the job", not "Cancel": AntD's Popconfirm dismisses itself with a
    // "Cancel" button, so the action needed a different word.
    await user.click(await screen.findByRole("button", { name: "Stop the job" }));

    await waitFor(() =>
      expect(jobRows.find((item) => item["id"] === "job-running")?.["status"]).toBe("CANCELLED"),
    );
    // Kept, not deleted — the row is what answers "why did it not run".
    expect(jobRows.find((item) => item["id"] === "job-running")).toBeDefined();
  });

  it("says what a retry will do before it is confirmed", async () => {
    withPermissions("jobs.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("jobs-table");
    await user.click(await screen.findByTestId("retry-JOB-000101"));

    expect(await screen.findByText(/attempt 2 of 3, on the same job/)).toBeInTheDocument();
  });
});

describe("a reader who may only watch", () => {
  it("gets no controls, and is told why", async () => {
    withPermissions();
    setJobsCanManage(false);
    render();

    await screen.findByTestId("jobs-table");
    // Said once at the top rather than as six disabled buttons: the reason is
    // a permission, which will not change while they look at it.
    expect(await screen.findByTestId("read-only")).toHaveTextContent("jobs.manage");
    expect(screen.queryByTestId("retry-JOB-000101")).not.toBeInTheDocument();
  });
});

describe("one job in full", () => {
  it("opens onto what it was asked to do and what it said", async () => {
    withPermissions("jobs.manage");
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("jobs-table");
    await waitFor(() => expect(within(table).getByText("Export — orders")).toBeInTheDocument());
    await user.click(within(table).getByText("Export — orders"));

    expect(await screen.findByTestId("job-payload")).toHaveTextContent("csv");
    expect(screen.getByTestId("job-lines")).toHaveTextContent("job accepted");
    expect(screen.getByTestId("job-error")).toHaveTextContent("Upstream timed out");
  });

  it("frames a retrying job's failure as one being handled", async () => {
    withPermissions("jobs.manage");
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("jobs-table");
    await waitFor(() => expect(within(table).getByText("Email — digest")).toBeInTheDocument());
    await user.click(within(table).getByText("Email — digest"));

    // Not "it failed": it failed and is being tried again, which is a
    // different thing to be told at a glance.
    expect(await screen.findByTestId("job-error")).toHaveTextContent(
      "Failed, and will be tried again",
    );
  });

  it("carries the result of one that worked", async () => {
    withPermissions("jobs.manage");
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("jobs-table");
    await waitFor(() => expect(within(table).getByText("Report — revenue")).toBeInTheDocument());
    await user.click(within(table).getByText("Report — revenue"));

    expect(await screen.findByTestId("job-result")).toHaveTextContent("artifact");
    expect(screen.queryByTestId("job-error")).not.toBeInTheDocument();
  });

  it("disables the drawer's controls for the same reasons the row does", async () => {
    withPermissions("jobs.manage");
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("jobs-table");
    await waitFor(() => expect(within(table).getByText("Reindex — search")).toBeInTheDocument());
    await user.click(within(table).getByText("Reindex — search"));

    // Running: cancellable, not retryable — the same answer in both places,
    // because both read `can_retry` from the server.
    expect(await screen.findByTestId("detail-retry")).toBeDisabled();
    expect(screen.getByTestId("detail-cancel")).toBeEnabled();
  });
});

describe("granting a spent job more attempts", () => {
  it("offers the grant on the row the retry refusal points at, and nowhere else", async () => {
    withPermissions("jobs.manage");
    render();

    await screen.findByTestId("jobs-table");
    // JOB-000102 is out of attempts, so it gets the grant instead of a retry.
    expect(await screen.findByTestId("grant-JOB-000102")).toBeEnabled();
    expect(screen.getByTestId("retry-JOB-000102")).toBeDisabled();
    // JOB-000101 has attempts left, so a grant would change nothing.
    expect(screen.queryByTestId("grant-JOB-000101")).not.toBeInTheDocument();
    expect(screen.getByTestId("retry-JOB-000101")).toBeEnabled();
  });

  it("grants one more, and the retry becomes available", async () => {
    withPermissions("jobs.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("jobs-table");
    await user.click(await screen.findByTestId("grant-JOB-000102"));

    await waitFor(() =>
      expect(jobRows.find((item) => item["id"] === "job-spent")?.["max_attempts"]).toBe(4),
    );
    // One more, not a number somebody types: "let it try again" is the useful
    // grant, and a spinner would be a decision nobody has an opinion about.
    expect(jobRows.find((item) => item["id"] === "job-spent")?.["can_retry"]).toBe(true);
  });

  it("says what the job may now do, not merely that something was saved", async () => {
    withPermissions("jobs.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("jobs-table");
    await user.click(await screen.findByTestId("grant-JOB-000102"));

    expect(await screen.findByText(/may now be tried 4 times/)).toBeInTheDocument();
  });

  it("is not offered to a reader who may only watch", async () => {
    withPermissions();
    setJobsCanManage(false);
    render();

    await screen.findByTestId("jobs-table");
    expect(screen.queryByTestId("grant-JOB-000102")).not.toBeInTheDocument();
  });
});
