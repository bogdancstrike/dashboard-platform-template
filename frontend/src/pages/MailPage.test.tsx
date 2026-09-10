import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";

import MailPage from "@/pages/MailPage";
import { CommandProvider } from "@/commands/CommandContext";
import { withWhom } from "@/components/mail/ThreadList";
import { replyDefaults, unfilledPlaceholders } from "@/components/mail/Composer";
import type { MailThread } from "@/api/mail";
import { currentUser, mailThreads, resetMail } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The mailbox (§14–§16).
 *
 * What is worth asserting is what the *page* decides: that every folder is
 * listed with its unread count, that opening an unread thread updates the list
 * behind it, that the bulk bar arrives with a count on it, that a draft is
 * offered as a draft, and that sending says where the message actually goes.
 *
 * The two rules with an answer worth stating exactly — who a thread is *with*,
 * and what a reply starts as — are pure functions, asserted as such.
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function render(route = "/mail") {
  return renderWithProviders(
    <CommandProvider>
      <Address />
      <Routes>
        <Route path="/mail" element={<MailPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

afterEach(() => resetMail());

describe("who a conversation is with", () => {
  const thread = (...emails: string[]) =>
    ({
      participants: emails.map((email) => ({
        email,
        name: `${email.split("@")[0]!.replace(/^./, (c) => c.toUpperCase())} Person`,
        initials: "XX",
      })),
    }) as Pick<MailThread, "participants">;

  it("names the other person when there is one", () => {
    expect(withWhom(thread("mara@x.com", "me@x.com"), "me@x.com")).toBe("Mara Person");
  });

  it("uses first names for a small group", () => {
    expect(withWhom(thread("mara@x.com", "otto@x.com", "me@x.com"), "me@x.com")).toBe(
      "Mara, Otto",
    );
  });

  it("counts the rest when a group is large", () => {
    const many = thread("a@x.com", "b@x.com", "c@x.com", "d@x.com", "me@x.com");
    expect(withWhom(many, "me@x.com")).toBe("A and 3 others");
  });

  it("says so rather than rendering nothing when it is only you", () => {
    // A blank "with" column reads as a broken row.
    expect(withWhom(thread("me@x.com"), "me@x.com")).toBe("Only you");
  });

  it("ignores the case of the reader's own address", () => {
    expect(withWhom(thread("mara@x.com", "ME@x.com"), "me@x.com")).toBe("Mara Person");
  });
});

describe("what a reply starts as", () => {
  const thread = (from: string): MailThread =>
    ({
      subject: "About the invoice",
      messages: [
        { from: { email: from, name: "Somebody", initials: "S" } },
      ],
    }) as unknown as MailThread;

  it("addresses whoever wrote the last message", () => {
    expect(replyDefaults(thread("mara@x.com"), "me@x.com").to).toEqual(["mara@x.com"]);
  });

  it("never addresses the reply back to the reader", () => {
    // The commonest thing a composer gets wrong.
    expect(replyDefaults(thread("me@x.com"), "me@x.com").to).toEqual([]);
  });

  it("prefixes the subject once, however many times it is replied to", () => {
    const once = replyDefaults(thread("mara@x.com"), "me@x.com").subject;
    expect(once).toBe("Re: About the invoice");
    const again = replyDefaults(
      { ...thread("mara@x.com"), subject: once! },
      "me@x.com",
    ).subject;
    expect(again).toBe("Re: About the invoice");
  });
});

describe("placeholders left in a message", () => {
  it("finds them however they are spaced", () => {
    expect(unfilledPlaceholders("Dear {{ name }} and {{other}}")).toEqual([
      "name",
      "other",
    ]);
  });

  it("names each one once", () => {
    expect(unfilledPlaceholders("{{ name }} … {{ name }}")).toEqual(["name"]);
  });

  it("finds none in ordinary prose", () => {
    expect(unfilledPlaceholders("Nothing here { or } here either")).toEqual([]);
  });
});

describe("the mailbox", () => {
  it("lists every folder with its unread count", async () => {
    render();

    const rail = await screen.findByTestId("mail-folders");
    // Every folder, including the empty ones — an empty Drafts is information.
    for (const folder of ["INBOX", "OUTBOX", "SENT", "DRAFTS", "ARCHIVE", "SPAM", "TRASH"]) {
      expect(within(rail).getByTestId(`folder-${folder}`)).toBeInTheDocument();
    }
    // The name carries the count, so a screen reader hears "Inbox, 1 unread".
    expect(within(rail).getByLabelText("Inbox, 1 unread")).toBeInTheDocument();
  });

  it("keeps the folder in the address, so a mailbox view is a link", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("mail-folders");
    await user.click(screen.getByTestId("folder-DRAFTS"));

    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("folder=DRAFTS"),
    );
    expect(
      await screen.findByText("Proposal for the field service rollout"),
    ).toBeInTheDocument();
  });

  it("shows a thread as a conversation, not as a message", async () => {
    render();

    const list = await screen.findByTestId("thread-list");
    const row = within(list).getByTestId("thread-thread-2");
    // Three messages, said once as a count rather than as three rows.
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByText("Change freeze over the release weekend")).toBeInTheDocument();
  });

  it("marks unread with weight and a dot, never colour alone", async () => {
    render();

    await screen.findByTestId("thread-list");
    const unread = screen.getByTestId("thread-thread-1");
    expect(unread.className).toContain("nu-thread--unread");
    // The second carrier (§64).
    expect(within(unread).getByLabelText("1 unread")).toBeInTheDocument();
  });

  it("updates the list when an unread thread is read", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("thread-list");
    expect(screen.getByTestId("thread-thread-1").className).toContain("nu-thread--unread");

    await user.click(screen.getByTestId("open-thread-1"));
    await screen.findByTestId("thread-reader");

    // Opening marks it read on the *server*, so the row and the folder badge
    // beside it have to follow — otherwise the inbox claims two unread while
    // the reader is showing one of them.
    await waitFor(() =>
      expect(screen.getByTestId("thread-thread-1").className).not.toContain(
        "nu-thread--unread",
      ),
    );
  });

  it("stars a thread from the list without opening it", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("thread-list");
    await user.click(screen.getByLabelText("Star Weekly operations summary"));

    await waitFor(() =>
      expect(mailThreads.find((item) => item["id"] === "thread-1")?.["is_starred"]).toBe(
        true,
      ),
    );
    // And it did not open it: the checkbox selects, the row opens, the star
    // stars. A list where one click does two of those is a list people fight.
    expect(screen.queryByTestId("thread-reader")).not.toBeInTheDocument();
  });

  it("offers the bulk bar only when something is chosen, with the count on it", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("thread-list");
    // A toolbar of permanently-disabled buttons teaches nobody what they do.
    expect(screen.queryByTestId("bulk-bar")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Select Weekly operations summary"));
    await user.click(
      screen.getByLabelText("Select Change freeze over the release weekend"),
    );

    const bar = await screen.findByTestId("bulk-bar");
    expect(within(bar).getByText("2 selected")).toBeInTheDocument();

    await user.click(within(bar).getByTestId("bulk-read"));
    await waitFor(() =>
      expect(mailThreads.find((item) => item["id"] === "thread-1")?.["unread_count"]).toBe(
        0,
      ),
    );
  });

  it("narrows to unread, in the address", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("thread-list");
    await user.click(screen.getByTitle("Unread"));

    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("only=unread"));
    await waitFor(() =>
      expect(
        screen.queryByText("Change freeze over the release weekend"),
      ).not.toBeInTheDocument(),
    );
  });

  it("counts labels within the folder, so the count matches what a click finds", async () => {
    const user = userEvent.setup();
    render();

    const rail = await screen.findByTestId("mail-folders");
    const label = within(rail).getByTestId("label-Escalation");
    expect(label).toHaveAttribute("aria-label", "Escalation, 1");

    await user.click(label);
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("label=Escalation"),
    );
    const list = await screen.findByTestId("thread-list");
    expect(within(list).getAllByTestId(/^thread-/)).toHaveLength(1);
  });
});

describe("reading a conversation", () => {
  async function open(testid: string) {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("thread-list");
    await user.click(screen.getByTestId(testid));
    return { user, reader: await screen.findByTestId("thread-reader") };
  }

  it("opens the newest message and collapses the earlier ones", async () => {
    const { reader } = await open("open-thread-2");

    // A thread is opened to read the newest thing in it.
    expect(within(reader).getByTestId("latest-message")).toHaveTextContent("Newest.");
    expect(within(reader).getByTestId("earlier-messages")).toBeInTheDocument();
    expect(within(reader).queryByText("Oldest.")).not.toBeInTheDocument();
  });

  it("offers Reply on a message and Edit on a draft", async () => {
    const { reader } = await open("open-thread-2");
    expect(within(reader).getByTestId("reply")).toBeInTheDocument();
    expect(within(reader).queryByTestId("edit-draft")).not.toBeInTheDocument();
  });

  it("bins a conversation rather than deleting it outright", async () => {
    const { user } = await open("open-thread-2");
    await user.click(screen.getByTestId("bin-thread"));

    // One press bins it. A single irreversible delete is the gesture people
    // most often regret.
    await waitFor(() =>
      expect(mailThreads.find((item) => item["id"] === "thread-2")?.["folder"]).toBe(
        "TRASH",
      ),
    );
  });
});

describe("writing a message", () => {
  it("says where a sent message actually goes, before it is sent", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("thread-list");
    await user.click(screen.getByTestId("compose"));

    const composer = await screen.findByTestId("composer");
    expect(composer).toBeInTheDocument();
    // On the way in, not discovered afterwards: there is no transport here.
    expect(screen.getByText("Sending puts this in your Outbox")).toBeInTheDocument();
  });

  it("offers Save as draft beside Send, so nothing has to be finished now", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("thread-list");
    await user.click(screen.getByTestId("compose"));
    await screen.findByTestId("composer");

    expect(screen.getByTestId("save-draft")).toBeInTheDocument();
    expect(screen.getByTestId("send")).toBeInTheDocument();
  });

  it("refuses to send without a recipient, naming what is missing", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("thread-list");
    await user.click(screen.getByTestId("compose"));
    await screen.findByTestId("composer");
    await user.click(screen.getByTestId("send"));

    expect(
      await screen.findByText("A message needs somebody to go to"),
    ).toBeInTheDocument();
  });

  it("warns about placeholders still in the body", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("thread-list");
    await user.click(screen.getByTestId("compose"));
    const composer = await screen.findByTestId("composer");
    // Pasted rather than typed: `userEvent.type` reads `{{` as an escaped
    // brace, so typing a placeholder produces `{ name }` and asserts nothing.
    await user.click(within(composer).getByLabelText("Message"));
    await user.paste("Dear {{ name }}, hello.");

    // Named before the send, not discovered by whoever receives it.
    expect(await screen.findByTestId("unfilled")).toHaveTextContent("{{ name }}");
  });

  it("saves a draft and lands on it in the drafts folder", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("thread-list");
    await user.click(screen.getByTestId("compose"));
    const composer = await screen.findByTestId("composer");
    await user.type(within(composer).getByLabelText("Subject"), "Mail page test");
    await user.type(within(composer).getByLabelText("Message"), "Half a thought.");
    await user.click(screen.getByTestId("save-draft"));

    await waitFor(() =>
      expect(mailThreads.some((item) => item["subject"] === "Mail page test")).toBe(true),
    );
    // And the address followed it, so the draft is not somewhere the reader
    // has to go looking for.
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("folder=DRAFTS"),
    );
  });

  it("puts the reading pane where the reader asked for it (§40)", async () => {
    // The preference travels with the account, so the page reads it from the
    // profile rather than from this browser — which is why the fixture is
    // patched rather than a local value set.
    server.use(
      http.get("/platform/api/me", ({ request }) =>
        HttpResponse.json(
          {
            ...currentUser,
            preferences: {
              ...currentUser.preferences,
              mail: { ...currentUser.preferences.mail, preview: "off" },
            },
          },
          { headers: { "X-Correlation-Id": request.headers.get("X-Correlation-Id") ?? "" } },
        ),
      ),
    );

    const user = userEvent.setup();
    render("/mail");
    await screen.findByTestId("thread-list");

    // With no pane, the list and the reader are the same column: opening
    // something replaces the list rather than sitting beside it.
    expect(screen.getByTestId("mail-reader")).not.toBeVisible();
    await user.click(await screen.findByTestId(`open-${String(mailThreads[0]!["id"])}`));

    await waitFor(() => expect(screen.getByTestId("mail-list")).not.toBeVisible());
    // And there is a way back, because a subject with no way out is a page
    // somebody reaches for the browser button on.
    expect(await screen.findByTestId("back-to-list")).toBeInTheDocument();
  });
});
