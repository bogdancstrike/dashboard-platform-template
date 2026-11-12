import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { meWithAi } from "@/test/handlers/assistant";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import { PageTour } from "./PageTour";

describe("PageTour", () => {
  it("opens the tour directly without the assistant", async () => {
    renderWithProviders(<PageTour />, { route: "/home" });
    await userEvent.click(await screen.findByRole("button", { name: "Help" }));
    expect(await screen.findByText("What is waiting for you")).toBeInTheDocument();
  });

  it("opens a help panel with the tour and a question box", async () => {
    server.use(meWithAi());
    renderWithProviders(<PageTour variant="side" />, { route: "/home" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await userEvent.click(await screen.findByRole("button", { name: "Help" }));
    expect(await screen.findByTestId("help-panel")).toBeInTheDocument();
    expect(screen.getByTestId("page-ask")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("help-take-tour"));
    expect(await screen.findByText("What is waiting for you")).toBeInTheDocument();
  });

  it("offers the question box even where there is no tour", async () => {
    server.use(meWithAi());
    renderWithProviders(<PageTour />, { route: "/nowhere" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await userEvent.click(await screen.findByRole("button", { name: "Help" }));
    expect(await screen.findByText("No tour for this page yet")).toBeInTheDocument();
  });
});
