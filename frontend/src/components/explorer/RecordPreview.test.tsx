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

  it.each([404, 403, 500])("explains a %s response with a trace ID and retry", async (status) => {
    server.use(http.get("/platform/api/records/task/task-1", () => HttpResponse.json({
      error: "record_error", message: "Cannot read the selected record", details: { missing: ["records.view"] },
    }, { status, headers: { "X-Correlation-ID": "preview-trace" } })));
    const user = userEvent.setup();
    renderPreview();
    expect(await screen.findByText("Cannot read the selected record")).toBeInTheDocument();
    expect(screen.getByText(/preview-trace/)).toBeInTheDocument();
    server.use(http.get("/platform/api/records/task/task-1", () => HttpResponse.json(recordDetail)));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Customer portal")).toBeInTheDocument();
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
