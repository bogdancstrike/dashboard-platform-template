import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Grid } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";

import ChatPage from "@/pages/ChatPage";
import { collabCalls, MARA, resetCollab } from "@/test/handlers/collab";
import { emitLive } from "@/test/collabLive";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

vi.mock("@/live/LiveProvider", async (original) => ({
  ...(await original<typeof import("@/live/LiveProvider")>()),
  useLiveEvents: (await import("@/test/collabLive")).useMockLiveEvents,
}));

/**
 * Team chat (§47): what the *page* decides — which conversation the address
 * names, what is unread, that a message with a mention and a reaction reaches
 * the server in the right shape, that a thread opens in the address, and that
 * the live channel's hints make the page re-read rather than guess.
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function render(route = "/chat/ch-general") {
  return renderWithProviders(
    <>
      <Address />
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:channelId" element={<ChatPage />} />
      </Routes>
    </>,
    { route },
  );
}

const desk = { xs: true, sm: true, md: true, lg: true, xl: true };

beforeEach(() => {
  vi.spyOn(Grid, "useBreakpoint").mockReturnValue(desk);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetCollab();
});

describe("the conversation list", () => {
  it("lists channels and direct messages with their unread counts", async () => {
    render();
    const rail = await screen.findByTestId("chat-rail");
    expect(await within(rail).findByTestId("channel-general")).toBeInTheDocument();
    expect(within(rail).getByTestId("channel-engineering")).toBeInTheDocument();
    expect(within(rail).getByTestId("channel-dm")).toHaveTextContent("Mara Manager");
    // A mention is said as one: "@2" rather than "2".
    expect(within(rail).getByLabelText("2 unread")).toBeInTheDocument();
    // A public channel the reader is not in is offered, not listed.
    expect(within(rail).queryByTestId("channel-sales")).not.toBeInTheDocument();
    await userEvent.click(within(rail).getByText("Browse 1 more channel"));
    expect(within(rail).getByTestId("channel-sales")).toBeInTheDocument();
  });

  it("opens the first conversation on a desk when the address names none", async () => {
    render("/chat");
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("/chat/ch-general"));
  });

  it("shows the list alone on a phone, and the conversation as the next screen", async () => {
    vi.spyOn(Grid, "useBreakpoint").mockReturnValue({ xs: true });
    render("/chat");
    const rail = await screen.findByTestId("chat-rail");
    expect(screen.queryByTestId("chat-pane")).not.toBeInTheDocument();
    await userEvent.click(await within(rail).findByTestId("channel-engineering"));
    expect(screen.getByTestId("address")).toHaveTextContent("/chat/ch-eng");
    expect(await screen.findByLabelText("Back to conversations")).toBeInTheDocument();
  });

  it("searches messages and opens the conversation at the hit", async () => {
    render();
    const search = await screen.findByLabelText("Search messages");
    await userEvent.type(search, "agenda");
    const results = await screen.findByTestId("chat-search-results");
    const hit = await within(results).findByText(/#general/);
    expect(screen.getByTestId("address")).toHaveTextContent("q=agenda");
    await userEvent.click(hit);
    expect(screen.getByTestId("address")).toHaveTextContent("m=m-3");
  });

  it("says when nothing matched", async () => {
    render();
    await userEvent.type(await screen.findByLabelText("Search messages"), "zzzz");
    expect(await screen.findByText("Nothing says “zzzz”")).toBeInTheDocument();
  });
});

describe("a conversation", () => {
  it("draws the messages with markdown, files, reactions, the new divider and seen-by", async () => {
    render();
    const pane = await screen.findByTestId("chat-messages");
    expect(await within(pane).findByText("#general", { selector: "strong" })).toBeInTheDocument();
    expect(within(pane).getByText("threads", { selector: "code" })).toBeInTheDocument();
    expect(within(pane).getByText("deck.pdf")).toBeInTheDocument();
    expect(within(pane).getByLabelText("👍 2")).toHaveAttribute("aria-pressed", "true");
    expect(within(pane).getByTestId("new-divider")).toBeInTheDocument();
    expect(within(pane).getByTestId("seen-by")).toHaveTextContent("Seen by Mara Manager");
    expect(within(pane).getByText("Load earlier messages")).toBeInTheDocument();
    // The reader's marker moved because the conversation was opened.
    await waitFor(() =>
      expect(collabCalls.some((call) => call.path === "/api/comments/read")).toBe(true),
    );
  });

  it("sends a message with a picked mention", async () => {
    render();
    const box = await screen.findByLabelText("Message #general");
    await userEvent.type(box, "Thanks @Ott");
    const option = await screen.findByRole("option", { name: /Otto Operator/ });
    fireEvent.mouseDown(option);
    await userEvent.type(box, "see you there{Enter}");
    await waitFor(() => {
      const sent = collabCalls.find((call) => call.path === "/api/comments" && call.method === "POST");
      expect(sent?.body).toMatchObject({
        resource_type: "chat_channel",
        resource_id: "ch-general",
        body: "Thanks @Otto Operator see you there",
        mention_ids: ["22222222-3333-4444-5555-666666666666"],
      });
    });
    expect(await screen.findByText(/see you there/)).toBeInTheDocument();
    // Typing said so, once, before the message went.
    expect(collabCalls.some((call) => call.path === "/api/comments/typing")).toBe(true);
  });

  it("reacts to a message and takes the reaction back", async () => {
    render();
    const pane = await screen.findByTestId("chat-messages");
    await userEvent.click(await within(pane).findByLabelText("👍 2"));
    await waitFor(() => expect(within(pane).getByLabelText("👍 1")).toHaveAttribute("aria-pressed", "false"));
    const second = within(pane).getAllByLabelText("Add a reaction")[1]!;
    await userEvent.click(second);
    await userEvent.click(await screen.findByLabelText("React 🎉"));
    await waitFor(() => expect(within(pane).getByLabelText("🎉 1")).toBeInTheDocument());
  });

  it("edits and deletes the reader's own line", async () => {
    render();
    const pane = await screen.findByTestId("chat-messages");
    await within(pane).findByText(/threads/);
    server.use(
      http.put("/platform/api/comments/:id", async ({ request }) => {
        const body = (await request.json()) as { body: string };
        return HttpResponse.json({ id: "m-1", body: body.body });
      }),
    );
    await userEvent.click(within(pane).getByRole("button", { name: "Edit" }));
    const editor = within(pane).getByLabelText("Edit comment by Ada Administrator");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Welcome, everyone");
    await userEvent.click(within(pane).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(pane).queryByLabelText("Edit comment by Ada Administrator")).toBeNull());
    await userEvent.click(within(pane).getByRole("button", { name: "Delete" }));
  });

  it("opens a thread in the address and replies in it", async () => {
    render();
    const pane = await screen.findByTestId("chat-messages");
    await userEvent.click(await within(pane).findByTestId("open-thread"));
    expect(screen.getByTestId("address")).toHaveTextContent("thread=m-1");
    const panel = await screen.findByTestId("thread-panel");
    expect(await within(panel).findByText("Got it")).toBeInTheDocument();
    await userEvent.type(within(panel).getByLabelText("Reply in thread"), "Me too{Enter}");
    await waitFor(() =>
      expect(collabCalls.find((call) => call.method === "POST" && call.path === "/api/comments")?.body).toMatchObject({
        parent_id: "m-1",
        body: "Me too",
      }),
    );
    await userEvent.click(within(panel).getByLabelText("Close thread"));
    await waitFor(() => expect(screen.queryByTestId("thread-panel")).not.toBeInTheDocument());
  });

  it("re-reads when a line arrives live, and shows who is typing", async () => {
    render();
    const pane = await screen.findByTestId("chat-messages");
    await within(pane).findByText(/threads/);
    emitLive({ type: "typing", resource_type: "chat_channel", resource_id: "ch-general", user: { id: MARA, name: "Mara Manager" } });
    expect(await screen.findByText("Mara is typing…")).toBeInTheDocument();
    server.use(
      http.get("/platform/api/comments", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("resource_type") !== "chat_channel") return undefined;
        return HttpResponse.json({
          items: [{ id: "live-1", resource_type: "chat_channel", resource_id: "ch-general", parent_id: null, body: "Arrived live", author: { id: MARA, name: "Mara Manager", avatar_url: null, job_title: null }, mentions: [], is_internal: false, is_pinned: false, edited_at: null, created_at: "2026-09-06T12:30:00Z", can_edit: false }],
          total: 1, resource_type: "chat_channel", resource_id: "ch-general", can_comment: true,
        });
      }),
    );
    emitLive({ type: "thread", action: "created", resource_type: "chat_channel", resource_id: "ch-general", author_id: MARA });
    expect(await within(pane).findByText("Arrived live")).toBeInTheDocument();
    expect(screen.queryByText("Mara is typing…")).not.toBeInTheDocument();
    // Another conversation's line only refreshes the list.
    emitLive({ type: "thread", resource_type: "chat_channel", resource_id: "ch-eng" });
    emitLive({ type: "chat.channel", channel_id: "ch-general" });
    emitLive({ type: "presence", user_id: MARA, status: "away" });
  });
});

describe("rooms", () => {
  it("creates a channel and opens it", async () => {
    render();
    await userEvent.click(await screen.findByTestId("chat-new-channel"));
    await userEvent.type(await screen.findByLabelText("Channel name"), "launch-plan");
    await userEvent.type(screen.getByLabelText("Channel topic"), "The launch");
    await userEvent.click(screen.getByLabelText("Private channel"));
    await userEvent.click(screen.getByTestId("create-channel"));
    await waitFor(() =>
      expect(collabCalls.find((call) => call.path === "/api/chat/channels")?.body).toMatchObject({
        name: "launch-plan",
        topic: "The launch",
        visibility: "PRIVATE",
      }),
    );
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("/chat/ch-6"));
  });

  it("starts a direct message", async () => {
    render();
    await userEvent.click(await screen.findByTestId("chat-new-direct"));
    const picker = await screen.findByRole("combobox", { name: "Person to message" });
    await userEvent.click(picker);
    await userEvent.type(picker, "Otto");
    await waitFor(() => expect(document.querySelector(".ant-select-item-option")).not.toBeNull());
    fireEvent.click(document.querySelector(".ant-select-item-option")!);
    await waitFor(() => expect(screen.getByTestId("open-direct")).toBeEnabled());
    await userEvent.click(screen.getByTestId("open-direct"));
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("/chat/dm-mara"));
  });

  it("joins a channel it was only reading, then leaves it", async () => {
    render("/chat/ch-sales");
    await userEvent.click(await screen.findByTestId("join-channel"));
    await waitFor(() => expect(collabCalls.some((call) => call.path === "/api/chat/channels/ch-sales/join")).toBe(true));
    await userEvent.click(await screen.findByTestId("leave-channel"));
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("/chat"));
  });

  it("mutes, lists members and opens the owner's settings", async () => {
    render();
    await userEvent.click(await screen.findByLabelText("Mute"));
    await waitFor(() => expect(collabCalls.find((call) => call.method === "PUT")?.body).toEqual({ muted: true }));
    await userEvent.click(screen.getByTestId("chat-members"));
    const members = await screen.findByTestId("channel-members");
    expect(within(members).getByText("Otto Operator")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Channel settings"));
    const name = await screen.findByDisplayValue("general");
    await userEvent.clear(name);
    await userEvent.type(name, "general-news");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(collabCalls.some((call) => (call.body as { name?: string })?.name === "general-news")).toBe(true));
  });

  it("archives a channel from its settings", async () => {
    render();
    await userEvent.click(await screen.findByLabelText("Channel settings"));
    await userEvent.click(await screen.findByRole("button", { name: "Archive channel" }));
    await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() => expect(collabCalls.some((call) => call.method === "DELETE" && call.path === "/api/chat/channels/ch-general")).toBe(true));
  });

  it("says plainly when a conversation is not there", async () => {
    render("/chat/nope");
    expect(await screen.findByText("That conversation does not exist, or you are not in it.")).toBeInTheDocument();
  });
});
