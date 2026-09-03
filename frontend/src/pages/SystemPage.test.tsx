import { screen } from "@testing-library/react";
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

    expect(await screen.findByText("database")).toBeInTheDocument();
    expect(screen.getByText("cache")).toBeInTheDocument();
    expect(screen.getByText("identity")).toBeInTheDocument();
    expect(screen.getByText("1.4 ms")).toBeInTheDocument();
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
});
