import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

describe("the per-record audit timeline", () => {
  it("asks only for this record's history", async () => {
    let requested: URLSearchParams | null = null;
    server.use(
      http.get("/platform/api/audit/timeline", ({ request }) => {
        requested = new URL(request.url).searchParams;
        return HttpResponse.json({
          items: [],
          total: 0,
          resource_type: "ticket",
          resource_id: "ticket-1",
          limit: 25,
        });
      }),
    );

    renderWithProviders(<AuditTimeline resourceType="ticket" resourceId="ticket-1" />);

    await waitFor(() => expect(requested).not.toBeNull());
    expect(requested!.get("resource_type")).toBe("ticket");
    expect(requested!.get("resource_id")).toBe("ticket-1");
  });

  it("summarises each entry and expands to its diff", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditTimeline resourceType="ticket" resourceId="ticket-1" />);

    expect(await screen.findByText("Mara Manager")).toBeInTheDocument();
    // Collapsed by default: a timeline is scanned, then one row is opened.
    expect(screen.queryByRole("table", { name: "Field changes" })).toBeNull();

    await user.click(screen.getByText("Mara Manager"));
    expect(await screen.findByRole("table", { name: "Field changes" })).toBeInTheDocument();
  });

  it("says a record has no history rather than showing an empty box", async () => {
    server.use(
      http.get("/platform/api/audit/timeline", () =>
        HttpResponse.json({
          items: [],
          total: 0,
          resource_type: "ticket",
          resource_id: "ticket-2",
          limit: 25,
        }),
      ),
    );

    renderWithProviders(<AuditTimeline resourceType="ticket" resourceId="ticket-2" />);

    expect(
      await screen.findByText("Nothing has happened to this record yet"),
    ).toBeInTheDocument();
  });

  it("names the missing permission when the reader may not see the history", async () => {
    server.use(
      http.get("/platform/api/audit/timeline", () =>
        HttpResponse.json(
          {
            error: "forbidden",
            message: "You do not have permission to perform this action.",
            details: { missing: ["records.view"], missing_labels: ["View records"] },
          },
          { status: 403 },
        ),
      ),
    );

    renderWithProviders(<AuditTimeline resourceType="ticket" resourceId="ticket-1" />);

    expect(
      await screen.findByText("You do not have permission to read this record's history"),
    ).toBeInTheDocument();
    expect(screen.getByText(/View records/)).toBeInTheDocument();
  });
});
