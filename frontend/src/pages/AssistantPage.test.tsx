import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assistantState, meWithAi, resetAssistant } from "@/test/handlers/assistant";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import AssistantPage from "./AssistantPage";

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderAt(route: string) {
  return renderWithProviders(
    <Routes>
      {["/assistant", "/assistant/:conversationId"].map((path) => (
        <Route key={path} path={path} element={<><AssistantPage /><Where /></>} />
      ))}
    </Routes>,
    { route },
  );
}

const original = window.matchMedia.bind(window);
function desktop(on: boolean) {
  window.matchMedia = ((query: string) => ({
    ...original(query),
    matches: on && /min-width/.test(query),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

beforeEach(() => {
  resetAssistant();
  server.use(meWithAi());
  desktop(true);
});
afterEach(() => {
  window.matchMedia = original;
});

describe("AssistantPage", () => {
  it("lists past conversations, opens one and searches", async () => {
    renderAt("/assistant");
    const rail = await screen.findByTestId("assistant-rail");
    expect(await within(rail).findByText("Tickets closest to their SLA")).toBeInTheDocument();
    expect(within(rail).getAllByTestId("assistant-conversation")).toHaveLength(2);
    expect(await screen.findByTestId("assistant-usage")).toHaveTextContent("1,234 tokens");

    await userEvent.click(within(rail).getByText("Tickets closest to their SLA"));
    expect(screen.getByTestId("where")).toHaveTextContent("/assistant/c-1");
    expect(await screen.findByText("Which tickets are close to SLA?")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox", { name: "Search conversations" }), "release");
    await waitFor(() => expect(within(rail).getAllByTestId("assistant-conversation")).toHaveLength(1));
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search conversations" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search conversations" }), "zzz");
    expect(await within(rail).findByText("No conversation matches.")).toBeInTheDocument();
  });

  it("renames and deletes from the row menu", async () => {
    renderAt("/assistant/c-1");
    const rail = await screen.findByTestId("assistant-rail");
    await within(rail).findByText("Tickets closest to their SLA");

    await userEvent.click(screen.getByRole("button", { name: "Actions for Tickets closest to their SLA" }));
    await userEvent.click(await screen.findByText("Rename"));
    const field = await screen.findByLabelText("Title");
    await userEvent.clear(field);
    await userEvent.type(field, "SLA watch{Enter}");
    expect(await within(rail).findByText("SLA watch")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Actions for SLA watch" }));
    await userEvent.click(await screen.findByText("Delete"));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(assistantState.conversations.some((c) => c.id === "c-1")).toBe(false));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/assistant$/));
  });

  it("starts a new conversation and moves to its address once answered", async () => {
    renderAt("/assistant/c-1");
    await screen.findByText("Which tickets are close to SLA?");
    await userEvent.click(screen.getByTestId("assistant-new"));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/assistant$/);
    await userEvent.type(await screen.findByTestId("assistant-input"), "Brand new{Enter}");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toMatch(/^\/assistant\/c-3/));
  });

  it("shows an empty history", async () => {
    assistantState.conversations = [];
    renderAt("/assistant");
    expect(await screen.findByText("No conversations yet.")).toBeInTheDocument();
  });

  it("on a phone shows the list, then the chat with a way back", async () => {
    desktop(false);
    renderAt("/assistant/c-1");
    expect(await screen.findByText("Which tickets are close to SLA?")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-rail")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByTestId("assistant-rail")).toBeInTheDocument();
  });
});
