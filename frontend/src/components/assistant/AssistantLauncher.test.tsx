import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { meWithAi, resetAssistant } from "@/test/handlers/assistant";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import { AssistantLauncher } from "./AssistantLauncher";

beforeEach(() => {
  resetAssistant();
  sessionStorage.clear();
});

describe("AssistantLauncher", () => {
  it("is not there for somebody without the assistant", async () => {
    renderWithProviders(<AssistantLauncher />, { route: "/home" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId("assistant-launcher")).toBeNull();
  });

  it("opens from the button and from ⌘J, remembers the conversation and starts a new one", async () => {
    server.use(meWithAi());
    renderWithProviders(<AssistantLauncher />, { route: "/home" });
    await userEvent.click(await screen.findByTestId("assistant-launcher"));
    expect(await screen.findByTestId("assistant-chat")).toBeInTheDocument();
    // Data mode by default in the panel.
    expect(screen.getByTestId("assistant-empty")).toHaveTextContent("Ask about your data");
    await userEvent.type(screen.getByTestId("assistant-input"), "From the panel{Enter}");
    await waitFor(() => expect(sessionStorage.getItem("nucleus.assistant.panel")).toBeTruthy());
    expect(screen.getByRole("link", { name: "Open the full page" }).getAttribute("href")).toMatch(/^\/assistant\/c-/);

    await userEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(sessionStorage.getItem("nucleus.assistant.panel")).toBeNull();
    await userEvent.click(screen.getByRole("link", { name: "Open the full page" }));

    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    expect(await screen.findByTestId("assistant-chat")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "j", metaKey: true });
  });

  it("hides the button on the assistant page itself", async () => {
    server.use(meWithAi());
    renderWithProviders(<AssistantLauncher />, { route: "/assistant" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId("assistant-launcher")).toBeNull();
  });
});
