/** The preview reads detail independently of projected rows and handles failed reads. */
import { http, HttpResponse, delay } from "msw";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";
import { recordDetail } from "@/test/handlers";
import { RecordPreview } from "./RecordPreview";

const body = "An article about migration.\n\n<script>alert('stored text')</script>\nThe complete final paragraph.";

function renderPreview() {
  return renderWithProviders(<RecordPreview resourceType="task" recordId="task-1" onClose={vi.fn()} />);
}

describe("record preview", () => {
  it("reads the complete text and metadata, escaping stored markup", async () => {
    server.use(http.get("/platform/api/records/task/task-1", () => HttpResponse.json({
      ...recordDetail,
      fields: recordDetail.fields.map((field) => field.name === "description" ? { ...field, value: body } : field),
    })));
    renderPreview();
    const article = await screen.findByRole("article", { name: "Description" });
    expect(article.textContent).toContain(body);
    expect(article.querySelector("script")).toBeNull();
    expect(screen.getByText("Customer portal")).toBeInTheDocument();
    expect(screen.getByText('"enterprise"', { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Assignee ID")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open full record/ })).toHaveAttribute("href", "/tasks/task-1");
  });

  it("explains an absent body while keeping the metadata readable", async () => {
    renderPreview();
    expect(await screen.findByText(/This record has no full text/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Metadata" })).toBeInTheDocument();
  });

  it("keeps loading separate from an empty record", async () => {
    server.use(http.get("/platform/api/records/task/task-1", async () => {
      await delay(150);
      return HttpResponse.json(recordDetail);
    }));
    renderPreview();
    expect(screen.getByRole("dialog").querySelector(".ant-skeleton")).not.toBeNull();
    expect(screen.queryByText(/This record has no full text/)).not.toBeInTheDocument();
    expect(await screen.findByText("Customer portal")).toBeInTheDocument();
  });

  /**
   * Every failed read says which way it failed, and every one of them carries
   * the id to quote — a reader who can only report "it did not work" cannot be
   * helped, and the preview is where a broken row is usually first noticed.
   */
  it.each([
    { status: 404, headline: "Record not found" },
    { status: 403, headline: "Your role does not include this record" },
    { status: 500, headline: "Could not load this record" },
  ])("explains a $status response with a trace ID", async ({ status, headline }) => {
    server.use(http.get("/platform/api/records/task/task-1", () => HttpResponse.json({
      error: "record_error", message: "Cannot read the selected record", details: { missing: ["records.view"] },
    }, { status, headers: { "X-Correlation-ID": "preview-trace" } })));
    renderPreview();
    expect(await screen.findByText(headline)).toBeInTheDocument();
    expect(screen.getByText("Cannot read the selected record")).toBeInTheDocument();
    expect(screen.getByText(/preview-trace/)).toBeInTheDocument();
  });

  /**
   * A retry appears only where a retry could work — the same rule the error
   * pages hold to (`PROBLEMS.not_found.retryable === false`). Offering one on
   * a 404 promises the address will resolve on the second press, and on a 403
   * that the reader's role changed while they were reading; pressing either
   * teaches them that this product's buttons do not mean anything.
   */
  it("retries a fault and does not pretend a refusal can be retried", async () => {
    const user = userEvent.setup();
    const fail = (status: number) =>
      server.use(http.get("/platform/api/records/task/task-1", () => HttpResponse.json({
        error: "record_error", message: "Cannot read the selected record", details: {},
      }, { status, headers: { "X-Correlation-ID": "preview-trace" } })));

    fail(500);
    const view = renderPreview();
    expect(await screen.findByTestId("failure-alert")).toHaveAttribute("data-failure", "failed");
    server.use(http.get("/platform/api/records/task/task-1", () => HttpResponse.json(recordDetail)));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Customer portal")).toBeInTheDocument();

    for (const status of [404, 403]) {
      fail(status);
      view.unmount();
      renderPreview();
      await screen.findByTestId("failure-alert");
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    }
  });

  it("loads related records only when requested and links to their own previews", async () => {
    const requested = vi.fn();
    server.use(http.get("/platform/api/relationships/task/task-1", () => {
      requested();
      return HttpResponse.json({ root: {}, total: 1, groups: [{
        direction: "outbound", relation: "project_id", label: "Project", total: 1, has_more: false,
        items: [{ id: "project-1", entity: "project", label: "Migration project", summary: "ACTIVE", explorable: true }],
      }] });
    }));
    const user = userEvent.setup();
    renderPreview();
    await screen.findByText("Customer portal");
    expect(requested).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Related records" }));
    const related = within(screen.getByRole("tabpanel", { name: "Related records" }));
    expect(await related.findByRole("link", { name: "Migration project" }))
      .toHaveAttribute("href", "/explore?resource=project&record=project-1");
  });
});
