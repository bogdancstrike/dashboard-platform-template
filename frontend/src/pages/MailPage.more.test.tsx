import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import MailPage from "@/pages/MailPage";
import { mailThreads, resetMail } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The mailbox's other half (§14–§16): every bulk action, the reader's own
 * controls, drafts, the bin, and what the page says when the mailbox or a
 * conversation cannot be read.
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function render(route = "/mail") {
  return renderWithProviders(
    <>
      <Address />
      <Routes>
        <Route path="/mail" element={<MailPage />} />
      </Routes>
    </>,
    { route },
  );
}

const thread = (id: string) => mailThreads.find((item) => item["id"] === id)!;

afterEach(() => resetMail());

describe("acting on several conversations", () => {
  async function select(...subjects: string[]) {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("thread-list");
    for (const subject of subjects) await user.click(screen.getByLabelText(`Select ${subject}`));
    return { user, bar: await screen.findByTestId("bulk-bar") };
  }

  it("marks them unread", async () => {
    const { user, bar } = await select("Change freeze over the release weekend");
    await user.click(within(bar).getByTestId("bulk-unread"));
    await waitFor(() => expect(thread("thread-2")["unread_count"]).toBe(1));
    expect(await screen.findByText("1 conversation updated")).toBeInTheDocument();
    // The selection is spent once the change lands.
    await waitFor(() => expect(screen.queryByTestId("bulk-bar")).not.toBeInTheDocument());
  });

  it("moves them to another folder", async () => {
    const { user, bar } = await select("Weekly operations summary", "Change freeze over the release weekend");
    await user.click(within(bar).getByTestId("bulk-move"));
    await user.click(await screen.findByRole("menuitem", { name: "Move to Archive" }));
    await waitFor(() => expect(thread("thread-1")["folder"]).toBe("ARCHIVE"));
    expect(await screen.findByText("2 conversations updated")).toBeInTheDocument();
  });

  it("labels them, or says there are no labels yet", async () => {
    const { user, bar } = await select("Weekly operations summary");
    await user.click(within(bar).getByTestId("bulk-label"));
    const items = await screen.findAllByRole("menuitem");
    await user.click(items[0]!);
    await waitFor(() => expect(screen.queryByTestId("bulk-bar")).not.toBeInTheDocument());
  });

  it("clears the selection without changing anything", async () => {
    const { user, bar } = await select("Weekly operations summary");
    await user.click(within(bar).getByRole("button", { name: "Clear" }));
    expect(screen.queryByTestId("bulk-bar")).not.toBeInTheDocument();
    expect(thread("thread-1")["unread_count"]).toBe(1);
  });

  it("reports a refused bulk action in the server's words", async () => {
    server.use(
      http.post("/platform/api/mail/threads/bulk", () =>
        HttpResponse.json({ error: "forbidden", message: "This mailbox is read-only." }, { status: 403 }),
      ),
    );
    const { user, bar } = await select("Weekly operations summary");
    await user.click(within(bar).getByTestId("bulk-read"));
    expect(await screen.findByText("This mailbox is read-only.")).toBeInTheDocument();
  });
});

describe("the reader's own controls", () => {
  async function open(id: string) {
    const user = userEvent.setup();
    render(`/mail?thread=${id}`);
    return { user, reader: await screen.findByTestId("thread-reader") };
  }

  it("unstars, marks unread, moves, and opens a reply", async () => {
    const { user } = await open("thread-2");
    await user.click(screen.getByTestId("reader-star"));
    await waitFor(() => expect(thread("thread-2")["is_starred"]).toBe(false));
    await user.click(screen.getByTestId("reader-read"));
    await waitFor(() => expect(thread("thread-2")["is_read"]).toBe(false));
    await user.click(screen.getByTestId("move-thread"));
    await user.click(await screen.findByRole("menuitem", { name: "Move to Archive" }));
    await waitFor(() => expect(thread("thread-2")["folder"]).toBe("ARCHIVE"));
    await user.click(screen.getByTestId("reader-reply"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("deletes a binned conversation for good, after asking", async () => {
    thread("thread-2")["folder"] = "TRASH";
    const { user } = await open("thread-2");
    const bin = screen.getByTestId("bin-thread");
    expect(bin).toHaveTextContent("Delete");
    await user.click(bin);
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Deleted for good")).toBeInTheDocument();
    expect(mailThreads.some((item) => item["id"] === "thread-2")).toBe(false);
  });

  it("edits a draft, and discards one after asking", async () => {
    const { user, reader } = await open("thread-3");
    await user.click(within(reader).getByTestId("edit-draft"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    const discard = within(reader).queryByTestId("discard-draft") ?? within(reader).getByRole("button", { name: /Discard/ });
    await user.click(discard);
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(await screen.findByText("Draft discarded")).toBeInTheDocument();
  });

  it("says a conversation could not be opened", async () => {
    server.use(
      http.get("/platform/api/mail/threads/:id", () =>
        HttpResponse.json({ error: "not_found", message: "That conversation is gone." }, { status: 404 }),
      ),
    );
    render("/mail?thread=nope");
    expect(await screen.findByText("That conversation is gone.")).toBeInTheDocument();
  });
});

describe("when the mailbox cannot be read", () => {
  it("says so and retries", async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get("/platform/api/mail/threads", () => {
        calls += 1;
        return HttpResponse.json({ error: "unavailable", message: "The mail store is not answering." }, { status: 503 });
      }),
    );
    render();
    expect(await screen.findByText("The mail store is not answering.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toBeGreaterThan(1));
  });

  it("says an empty search found nothing in this folder", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("thread-list");
    await user.type(screen.getByRole("searchbox", { name: "Search this folder" }), "ζζζ");
    expect(await screen.findByText(/matches “ζζζ”|is empty/)).toBeInTheDocument();
  });
});
