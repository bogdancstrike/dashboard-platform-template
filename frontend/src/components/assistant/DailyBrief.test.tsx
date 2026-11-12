import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { meWithAi } from "@/test/handlers/assistant";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import { DailyBrief } from "./DailyBrief";

describe("DailyBrief", () => {
  it("is absent without the assistant", async () => {
    renderWithProviders(<DailyBrief />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId("daily-brief")).toBeNull();
  });

  it("ranks what is waiting with reasons and links, and refreshes", async () => {
    server.use(meWithAi());
    renderWithProviders(<DailyBrief />);
    expect(await screen.findByTestId("brief-headline")).toHaveTextContent("Two things need you before lunch.");
    expect(screen.getByTestId("brief-item-sla")).toHaveTextContent("Now");
    expect(screen.getByRole("link", { name: "2 tickets at SLA" })).toHaveAttribute("href", "/tickets");
    expect(screen.getByRole("link", { name: "TIC-1 Login broken" })).toHaveAttribute("href", "/tickets/t-1");
    expect(screen.getByText(/Ranked by the assistant/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("brief-refresh"));
    expect(await screen.findByText("Refreshed: one thing left.")).toBeInTheDocument();
    expect(screen.getByText(/Ranked by rule/)).toBeInTheDocument();
  });

  it("says when it could not be written or refreshed", async () => {
    server.use(
      meWithAi(),
      http.get("/platform/api/assistant/brief", () => HttpResponse.json({ error: "x", message: "no" }, { status: 500 })),
      http.post("/platform/api/assistant/brief", () => HttpResponse.json({ error: "rate_limited", message: "Too fast" }, { status: 429 })),
    );
    renderWithProviders(<DailyBrief />);
    expect(await screen.findByText("The brief could not be written just now.")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("brief-refresh"));
    expect(await screen.findByText("Too fast")).toBeInTheDocument();
  });
});
