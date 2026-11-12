import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assistantState, meWithAi, resetAssistant } from "@/test/handlers/assistant";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import { AssistantChat } from "./AssistantChat";

beforeEach(() => {
  resetAssistant();
  server.use(meWithAi());
});
afterEach(() => vi.restoreAllMocks());

describe("AssistantChat", () => {
  it("shows a conversation's history with sources, lookups and usage", async () => {
    renderWithProviders(<AssistantChat conversationId="c-1" />);
    expect(await screen.findByText("Which tickets are close to SLA?")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "TIC-1" }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Used 1 lookup/)).toBeInTheDocument();
    expect(screen.getByText("30 tokens")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-citations")).toHaveTextContent("Sources");
  });

  it("starts a new conversation on the first message and streams the answer", async () => {
    const onChange = vi.fn();
    renderWithProviders(<AssistantChat conversationId={null} onConversationChange={onChange} />);
    expect(await screen.findByTestId("assistant-empty")).toHaveTextContent("How can I help?");
    await userEvent.type(screen.getByTestId("assistant-input"), "Say hello{Enter}");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const created = assistantState.conversations[0]!;
    expect(created.messages?.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(created.mode).toBe("general");
  });

  it("uses a suggestion, in the data mode chosen before the first message", async () => {
    const onChange = vi.fn();
    renderWithProviders(<AssistantChat conversationId={null} onConversationChange={onChange} />);
    await userEvent.click(await screen.findByText("Data"));
    expect(screen.getByTestId("assistant-empty")).toHaveTextContent("Ask about your data");
    await userEvent.click(screen.getByText("Which of my tasks are overdue?"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(assistantState.conversations[0]!.mode).toBe("data");
  });

  it("answers in an existing conversation, regenerates, switches mode and copies", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderWithProviders(<AssistantChat conversationId="c-2" />);
    await screen.findByTestId("assistant-empty");
    await userEvent.type(screen.getByTestId("assistant-input"), "Write it");
    await userEvent.click(screen.getByTestId("assistant-send"));
    expect(await screen.findByText(/Hello from the/)).toBeInTheDocument();

    assistantState.reply = "A better answer.";
    await userEvent.click(screen.getByTestId("assistant-regenerate"));
    expect(await screen.findByText("A better answer.")).toBeInTheDocument();
    expect(screen.queryByText(/Hello from the/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    expect(writeText).toHaveBeenCalledWith("A better answer.");

    await userEvent.click(screen.getByText("Data"));
    await waitFor(() => expect(assistantState.conversations.find((c) => c.id === "c-2")!.mode).toBe("data"));
  });

  it("says why a turn was refused", async () => {
    assistantState.failTurn = true;
    renderWithProviders(<AssistantChat conversationId="c-2" />);
    await screen.findByTestId("assistant-empty");
    await userEvent.type(screen.getByTestId("assistant-input"), "Again{Enter}");
    expect(await screen.findByText(/faster than it can answer/)).toBeInTheDocument();
  });

  it("shows the error event and a failed copy", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } });
    server.use(
      http.post("/platform/api/assistant/conversations/:id/messages", () =>
        new HttpResponse('event: delta\ndata: {"text":"Part"}\n\nevent: error\ndata: {"message":"The assistant took too long — try again."}\n\n', {
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    );
    renderWithProviders(<AssistantChat conversationId="c-1" />);
    await screen.findByText("Which tickets are close to SLA?");
    await userEvent.type(screen.getByTestId("assistant-input"), "Slow one{Enter}");
    expect(await screen.findByText("The assistant took too long — try again.")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Copy answer" })[0]!);
    expect(await screen.findByText("Could not copy")).toBeInTheDocument();
  });

  it("can be stopped mid-answer", async () => {
    let release: () => void = () => undefined;
    server.use(
      http.post("/platform/api/assistant/conversations/:id/messages", () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: tool\ndata: {"name":"count_records","status":"running"}\n\nevent: delta\ndata: {"text":"Partial"}\n\n'));
            release = () => controller.close();
          },
        });
        return new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream" } });
      }),
    );
    renderWithProviders(<AssistantChat conversationId="c-2" compact />);
    await screen.findByTestId("assistant-empty");
    await userEvent.type(screen.getByTestId("assistant-input"), "Long{Enter}");
    expect(await screen.findByText("Partial")).toBeInTheDocument();
    expect(screen.getByText(/Looking up count records/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("assistant-stop"));
    await waitFor(() => expect(screen.queryByTestId("assistant-stop")).toBeNull());
    release();
  });

  it("renders stopped and failed answers from history", async () => {
    const convo = assistantState.conversations[0]!;
    convo.messages = [
      { ...convo.messages![1]!, id: "m-s", status: "stopped", content: "", citations: [], steps: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
      { ...convo.messages![1]!, id: "m-e", status: "error", error: null, content: "x", citations: [], steps: [] },
    ];
    renderWithProviders(<AssistantChat conversationId="c-1" />);
    expect(await screen.findByText("Stopped.")).toBeInTheDocument();
    expect(screen.getByText("(no answer)")).toBeInTheDocument();
    expect(screen.getByText("The assistant could not answer.")).toBeInTheDocument();
  });
});
