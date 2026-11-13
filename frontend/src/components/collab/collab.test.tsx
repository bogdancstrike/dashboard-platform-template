import { render as plainRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";

import { CommentThread } from "@/components/comments/CommentThread";
import { Composer, mentionAt } from "@/components/collab/Composer";
import { dayLabel, typingText } from "@/components/collab/ConversationBits";
import { chunks, MarkdownLite, renderInline } from "@/components/collab/MarkdownLite";
import { AttachmentList, clockTime, initials } from "@/components/collab/MessageItem";
import { sameDay } from "@/components/collab/ConversationView";
import { MeetingNotes } from "@/components/docs/MeetingNotes";
import { emitLive } from "@/test/collabLive";
import { collabCalls, resetCollab } from "@/test/handlers/collab";
import { renderWithProviders } from "@/test/render";

vi.mock("@/live/LiveProvider", async (original) => ({
  ...(await original<typeof import("@/live/LiveProvider")>()),
  useLiveEvents: (await import("@/test/collabLive")).useMockLiveEvents,
}));

vi.mock("@/api/files", async (original) => {
  const actual = await original<typeof import("@/api/files")>();
  return { ...actual, putBytes: vi.fn((_t: unknown, _f: unknown, progress: (n: number) => void) => Promise.resolve(progress(1))) };
});

afterEach(() => resetCollab());

describe("markdown-lite", () => {
  it("splits text into paragraphs, code, lists and quotes", () => {
    const parts = chunks("Hello\nworld\n\n```\ncode\n```\n- one\n- two\n1. first\n> said");
    expect(parts.map((part) => part.kind)).toEqual(["p", "code", "ul", "ol", "quote"]);
  });

  it("renders marks, safe links only, and mentions", () => {
    plainRender(
      <MarkdownLite
        text={"**bold** *it* _em_ ~~old~~ `x` [site](https://example.com) [bad](javascript:alert(1)) https://n.example/a @Mara Manager\n- item\n1. num\n> quote\n```\nblock\n```"}
        mentions={["Mara Manager"]}
      />,
    );
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("it").tagName).toBe("EM");
    expect(screen.getByText("old").tagName).toBe("S");
    expect(screen.getByRole("link", { name: "site" })).toHaveAttribute("href", "https://example.com/");
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
    expect(screen.getByRole("link", { name: "https://n.example/a" })).toBeInTheDocument();
    expect(screen.getByText("@Mara Manager")).toHaveClass("nx-co-mention");
    expect(screen.getByText("block")).toBeInTheDocument();
  });

  it("does not highlight a name the server did not resolve, and keeps local links in the app", () => {
    plainRender(<>{renderInline("@Nobody Here [docs](/docs)", "k", ["Mara Manager"])}</>);
    expect(screen.getByText("@Nobody Here")).not.toHaveClass("nx-co-mention");
    expect(screen.getByRole("link", { name: "docs" })).not.toHaveAttribute("target");
  });
});

describe("small rules", () => {
  it("finds the mention being typed", () => {
    expect(mentionAt("hi @Ma", 6)).toEqual({ start: 3, query: "Ma" });
    expect(mentionAt("hi @Mara Ma", 11)).toEqual({ start: 3, query: "Mara Ma" });
    expect(mentionAt("email@x", 7)).toBeNull();
    expect(mentionAt("no mention", 10)).toBeNull();
  });

  it("says who is typing, and names days", () => {
    expect(typingText([])).toBe("");
    expect(typingText(["Mara Manager"])).toBe("Mara is typing…");
    expect(typingText(["Mara Manager", "Otto Operator"])).toBe("Mara and Otto are typing…");
    expect(typingText(["A", "B", "C"])).toBe("A and 2 others are typing…");
    const today = new Date(2026, 8, 6, 12);
    expect(dayLabel(new Date(2026, 8, 6, 9).toISOString(), today)).toBe("Today");
    expect(dayLabel(new Date(2026, 8, 5, 9).toISOString(), today)).toBe("Yesterday");
    expect(dayLabel(new Date(2025, 0, 2).toISOString(), today)).toMatch(/2025/);
    expect(initials("ada lovelace byron")).toBe("AL");
    expect(clockTime("2026-09-06T10:05:00Z")).toMatch(/\d/);
    expect(sameDay("2026-09-06T10:00:00Z", "2026-09-06T11:00:00Z")).toBe(true);
  });
});

describe("the composer", () => {
  it("sends on Enter, keeps Shift+Enter as a new line, and inserts an emoji", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<Composer onSend={onSend} label="Box" />);
    const box = screen.getByLabelText("Box");
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}two");
    await userEvent.click(screen.getByLabelText("Emoji"));
    await userEvent.click(await screen.findByLabelText("Insert 🎉"));
    await userEvent.type(box, "{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]![0].body).toContain("line one\ntwo");
    expect(onSend.mock.calls[0]![0].body).toContain("🎉");
  });

  it("keeps the draft when sending fails, and Escape cancels an edit", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("no"));
    const onCancel = vi.fn();
    renderWithProviders(<Composer onSend={onSend} onCancel={onCancel} label="Box" initial="draft" />);
    await userEvent.click(screen.getByTestId("send-message"));
    expect(screen.getByLabelText("Box")).toHaveValue("draft");
    await userEvent.type(screen.getByLabelText("Box"), "{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("picks a mention with the keyboard", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<Composer onSend={onSend} label="Box" />);
    const box = screen.getByLabelText("Box");
    await userEvent.type(box, "@Ot");
    await screen.findByRole("option", { name: /Otto Operator/ });
    await userEvent.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    await waitFor(() => expect(box).toHaveValue("@Otto Operator "));
    await userEvent.type(box, "{Enter}");
    await waitFor(() => expect(onSend.mock.calls[0]![0].mention_ids).toHaveLength(1));
  });

  it("uploads a file before the message goes, and sends its id", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<Composer onSend={onSend} label="Box" />);
    const input = screen.getByTestId("composer-files");
    await userEvent.upload(input, new File(["hello"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("send-message")).toBeEnabled());
    await userEvent.click(screen.getByTestId("send-message"));
    await waitFor(() => expect(onSend.mock.calls[0]![0].attachment_ids).toHaveLength(1));
  });

  it("lets a file be taken off before sending", async () => {
    renderWithProviders(<Composer onSend={vi.fn()} label="Box" />);
    await userEvent.upload(screen.getByTestId("composer-files"), new File(["x"], "a.txt"));
    await userEvent.click(await screen.findByLabelText("Remove a.txt"));
    expect(screen.queryByText("a.txt")).toBeNull();
  });
});

describe("attachments", () => {
  it("opens a file through a signed link", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderWithProviders(<AttachmentList files={[{ id: "file-1", name: "deck.pdf", size_bytes: 2048, mime_type: null }]} />);
    await userEvent.click(screen.getByText("deck.pdf"));
    await waitFor(() => expect(open).toHaveBeenCalled());
  });
});

describe("a record's thread", () => {
  it("shows the pages about the record, typing, and new lines as they arrive", async () => {
    renderWithProviders(<CommentThread resourceType="task" resourceId="task-1" />);
    const thread = await screen.findByTestId("comment-thread");
    const backlinks = await within(thread).findByTestId("record-backlinks");
    expect(within(backlinks).getByText("Engineering handbook")).toBeInTheDocument();
    emitLive({ type: "typing", resource_type: "task", resource_id: "task-1", user: { id: "u-2", name: "Otto Operator" } });
    expect(await within(thread).findByText("Otto is typing…")).toBeInTheDocument();
    emitLive({ type: "thread.read", resource_type: "task", resource_id: "task-1" });
    emitLive({ type: "thread", resource_type: "task", resource_id: "task-1", author_id: "u-2" });
    await waitFor(() => expect(within(thread).queryByText("Otto is typing…")).toBeNull());
  });

  it("replies to a comment, naming whom it answers", async () => {
    renderWithProviders(<CommentThread resourceType="task" resourceId="task-1" />);
    const thread = await screen.findByTestId("comment-thread");
    const reply = (await within(thread).findAllByRole("button", { name: "Reply" }))[0]!;
    await userEvent.click(reply);
    expect(within(thread).getByText(/Replying to/)).toBeInTheDocument();
    await userEvent.click(within(thread).getByRole("button", { name: "Cancel" }));
    expect(within(thread).queryByText(/Replying to/)).toBeNull();
  });
});

describe("meeting notes on an event", () => {
  function render(eventId: string) {
    const view = renderWithProviders(
      <Routes>
        <Route path="/" element={<MeetingNotes eventId={eventId} />} />
        <Route path="/docs/:id" element={<span>doc opened</span>} />
      </Routes>,
    );
    return view;
  }

  it("lists the notes taken and opens them", async () => {
    render("event-1");
    const notes = await screen.findByTestId("meeting-notes");
    expect(await within(notes).findByText("Vendor call — 2026-09-05")).toBeInTheDocument();
    await userEvent.click(within(notes).getByTestId("take-notes"));
    expect(await screen.findByText("doc opened")).toBeInTheDocument();
  });

  it("takes notes for an event that has none", async () => {
    render("event-2");
    const notes = await screen.findByTestId("meeting-notes");
    expect(await within(notes).findByText("No notes yet.")).toBeInTheDocument();
    await userEvent.click(within(notes).getByTestId("take-notes"));
    expect(await screen.findByText("doc opened")).toBeInTheDocument();
    expect(collabCalls.some((call) => call.path === "/api/docs/meetings")).toBe(true);
  });
});
