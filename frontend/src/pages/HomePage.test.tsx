import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";
import { HttpResponse, http } from "msw";

import HomePage, { greeting, whatIsWaiting } from "@/pages/HomePage";
import { CommandProvider } from "@/commands/CommandContext";
import { currentUser } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * `/home` (§40).
 *
 * The page is composition — every number on it belongs to another endpoint and
 * is asserted where that endpoint is tested. What is worth asserting *here* is
 * the two rules the page itself owns: which things count as waiting (and in
 * what order), and that a card for a feature the reader cannot use is absent
 * rather than empty.
 */
function render(route = "/home") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/home" element={<HomePage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

describe("the greeting", () => {
  it("follows the reader's own clock", () => {
    expect(greeting(new Date(2026, 0, 1, 9))).toBe("Good morning");
    expect(greeting(new Date(2026, 0, 1, 14))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 0, 1, 21))).toBe("Good evening");
    // "Good evening" at two in the morning is the sort of thing that makes a
    // whole page feel careless.
    expect(greeting(new Date(2026, 0, 1, 2))).toBe("Still up");
  });
});

describe("what counts as waiting", () => {
  const none = {
    acknowledgements: 0,
    invitations: 0,
    mail: 0,
    notifications: 0,
    overdue: 0,
  };

  it("drops a count of nought rather than drawing it", () => {
    // A row of zeroes teaches a reader to stop looking at the strip, and then
    // the one that is not zero is invisible too.
    expect(whatIsWaiting(none)).toEqual([]);
    expect(whatIsWaiting({ ...none, mail: 2 }).map((item) => item.key)).toEqual(["mail"]);
  });

  it("orders by urgency and not by size", () => {
    // Twelve unread notifications are less urgent than one policy nobody has
    // agreed to; sorting by count would put them first every time.
    const order = whatIsWaiting({
      acknowledgements: 1,
      invitations: 2,
      mail: 8,
      notifications: 40,
      overdue: 3,
    }).map((item) => item.key);
    expect(order).toEqual([
      "acknowledgements",
      "overdue",
      "invitations",
      "mail",
      "notifications",
    ]);
  });

  it("sends each count to the rows it counted", () => {
    const waiting = whatIsWaiting({ ...none, invitations: 1, mail: 1 });
    // The number and the page behind it cannot disagree about what it meant.
    expect(waiting.find((item) => item.key === "invitations")?.to).toBe(
      "/calendar?view=agenda&mine=1",
    );
    expect(waiting.find((item) => item.key === "mail")?.to).toBe("/mail?only=unread");
  });

  it("agrees in number, because '1 of your tasks are past due' reads as a bug", () => {
    expect(whatIsWaiting({ ...none, overdue: 1 })[0]!.label).toBe(
      "of your tasks is past its due date",
    );
    expect(whatIsWaiting({ ...none, overdue: 4 })[0]!.label).toBe(
      "of your tasks are past their due date",
    );
    expect(whatIsWaiting({ ...none, mail: 1 })[0]!.label).toBe("unread conversation");
    expect(whatIsWaiting({ ...none, mail: 3 })[0]!.label).toBe("unread conversations");
  });
});

describe("the page", () => {
  it("greets the reader by name, with their role and the platform's own version", async () => {
    render();

    // All three from the server: `/api/me` and `/meta/app`. A version typed
    // into the page is a version that is wrong after the next release.
    expect(await screen.findByText(/Ada/)).toBeInTheDocument();
    expect(screen.getByText(/Administrator/)).toBeInTheDocument();
    expect(screen.getByText(/Nucleus/)).toBeInTheDocument();
  });

  it("leaves out a card the reader has no permission for, rather than emptying it", async () => {
    render();

    // The notices and the feed need no permission, so they are always there.
    expect(await screen.findByTestId("home-notices")).toBeInTheDocument();
    expect(screen.getByTestId("home-activity")).toBeInTheDocument();

    // The fixture's reader holds four permissions and none of these three, so
    // the cards are *absent*. An empty "Today" for somebody with no calendar
    // is a worse answer than no card at all (§76).
    expect(screen.queryByTestId("home-today")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-tasks")).not.toBeInTheDocument();
  });

  it("draws a card as soon as the reader can use the feature", async () => {
    // The other half of the same rule: the gate has to open, not only close.
    server.use(
      http.get("/platform/api/me", () =>
        HttpResponse.json({
          ...currentUser,
          permissions: [...currentUser.permissions, "calendar.view", "tasks.view"],
        }),
      ),
    );
    render();

    expect(await screen.findByTestId("home-today")).toBeInTheDocument();
    expect(screen.getByTestId("home-tasks")).toBeInTheDocument();
  });

  it("links every card to the page it summarises", async () => {
    render();

    const notices = await screen.findByTestId("home-notices");
    expect(within(notices).getByRole("link", { name: /noticeboard/i })).toHaveAttribute(
      "href",
      "/announcements",
    );
    const feed = screen.getByTestId("home-activity");
    expect(within(feed).getByRole("link", { name: /feed/i })).toHaveAttribute(
      "href",
      "/activity",
    );
  });

  it("says so in a sentence when nothing is waiting", async () => {
    render();

    // The fixture's administrator has no unread anything, so the strip is the
    // reassuring sentence rather than a row of noughts.
    const strip = await screen.findByTestId("waiting");
    expect(strip).toBeInTheDocument();
  });
});
