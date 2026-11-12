import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePageCommands } from "@/commands/CommandContext";
import { meWithAi } from "@/test/handlers/assistant";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import { highlight, PageAsk, visibleControls } from "./PageAsk";

const ran = vi.fn();

function Page() {
  usePageCommands("test", [{ id: "test.cmd", label: "Run the test command", run: ran }]);
  return (
    <div>
      <button type="button" data-testid="go-button" aria-label="Go">Go</button>
      <div hidden><span data-testid="hidden-one">x</span></div>
      <PageAsk stops={[{ title: "Opening", description: "About the page" }]} />
    </div>
  );
}

afterEach(() => ran.mockReset());

describe("PageAsk", () => {
  it("answers, highlights the control and runs the proposed action only after confirming", async () => {
    let sent: { controls: { id: string }[]; commands: { id: string }[]; stops: unknown[] } | null = null;
    server.use(
      meWithAi(),
      http.post("/platform/api/assistant/page-help", async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        return HttpResponse.json({ answer: "Press **Go**.", highlight: "go-button", action: { id: "test.cmd", label: "Run the test command" }, source: "ai" });
      }),
    );
    renderWithProviders(<Page />);
    await userEvent.type(screen.getByTestId("page-ask-input"), "how do I go?{Enter}");
    expect(await screen.findByTestId("page-ask-answer")).toHaveTextContent("Press Go.");
    expect(sent!.controls.map((c) => c.id)).toEqual(["go-button"]);
    expect(sent!.commands.map((c) => c.id)).toContain("test.cmd");
    expect(screen.getByTestId("go-button")).toHaveClass("nx-ai-highlight");

    await userEvent.click(screen.getByRole("button", { name: "Show me" }));
    await userEvent.click(screen.getByTestId("page-ask-action"));
    expect(ran).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Yes, do it" }));
    await waitFor(() => expect(ran).toHaveBeenCalledTimes(1));
  });

  it("shows a failure", async () => {
    server.use(meWithAi());
    renderWithProviders(<Page />);
    await userEvent.type(screen.getByTestId("page-ask-input"), "fail");
    await userEvent.click(screen.getByTestId("page-ask-go"));
    expect(await screen.findByText("Busy")).toBeInTheDocument();
  });

  it("finds controls and highlights only what exists", () => {
    document.body.innerHTML = '<button data-testid="a" title="Alpha"></button><button data-testid="a"></button><span data-testid="b">Beta  text</span>';
    expect(visibleControls()).toEqual([{ id: "a", label: "Alpha" }, { id: "b", label: "Beta text" }]);
    expect(highlight("missing")).toBe(false);
    expect(highlight("a")).toBe(true);
  });
});
