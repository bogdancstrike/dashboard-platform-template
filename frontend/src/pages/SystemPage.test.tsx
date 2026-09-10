import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import SystemPage from "@/pages/SystemPage";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

describe("the system health page", () => {
  it("shows the service metadata the API published", async () => {
    renderWithProviders(<SystemPage />);

    expect(await screen.findByText("template-spa")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:8080/realms/template")).toBeInTheDocument();
  });

  it("lists every dependency with its status and latency", async () => {
    renderWithProviders(<SystemPage />);

    // Scoped to the table: the history cards below name a service's category
    // too, and "database" now legitimately appears twice on the page.
    const table = await screen.findByTestId("dependency-table");
    expect(within(table).getByText("database")).toBeInTheDocument();
    expect(within(table).getByText("cache")).toBeInTheDocument();
    expect(within(table).getByText("identity")).toBeInTheDocument();
    expect(within(table).getByText("1.4 ms")).toBeInTheDocument();
    // A null latency renders as an em dash, not as "null".
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("surfaces the correlation id when a request fails", async () => {
    // The id is the whole point of the error panel: a screenshot carrying it is
    // a failure somebody can find in the logs.
    server.use(
      http.get("/platform/meta/app", () =>
        HttpResponse.json(
          { error: "service_unavailable", message: "database is unreachable" },
          { status: 503, headers: { "X-Correlation-ID": "abc123def456" } },
        ),
      ),
    );

    renderWithProviders(<SystemPage />);

    expect(await screen.findByText("database is unreachable")).toBeInTheDocument();
    expect(await screen.findByText("abc123def456")).toBeInTheDocument();
    expect(screen.getByText("503 service_unavailable")).toBeInTheDocument();
  });

  it("says what each dependency has been doing, not only what it is doing (§24)", async () => {
    const user = userEvent.setup();
    // Listened for rather than stubbed, so the default handler still answers
    // and the assertion is about *which question was asked* rather than about
    // a body this test invented.
    const asked: string[] = [];
    const listen = ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/health/history")) {
        asked.push(url.searchParams.get("period") ?? "");
      }
    };
    server.events.on("request:start", listen);

    renderWithProviders(<SystemPage />);

    // The window it opens on, and one service's history drawn under it.
    await waitFor(() => expect(asked).toContain("1d"));
    const card = await screen.findByTestId("health-postgres");
    // Both uptime figures, both named: the row's lifetime number and the
    // window's are different, and an unlabelled one gets quoted wrongly.
    expect(within(card).getByText(/in view/)).toBeInTheDocument();
    expect(within(card).getByText(/lifetime/)).toBeInTheDocument();
    // And the outage as one period rather than as two points.
    expect(within(card).getAllByText("degraded")).toHaveLength(1);

    // A different window is a different question, asked of the server.
    await user.click(screen.getByText("7 days", { selector: ".ant-segmented-item-label" }));
    await waitFor(() => expect(asked).toContain("7d"));
    server.events.removeListener("request:start", listen);
  });
});
