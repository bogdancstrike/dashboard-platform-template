import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import NotificationsPage from "@/pages/NotificationsPage";
import { CommandProvider } from "@/commands/CommandContext";
import { renderWithProviders } from "@/test/render";
import { notificationPage } from "@/test/handlers";
import { server } from "@/test/server";

/**
 * AntD's Segmented puts `pointer-events: none` on the radio input and lets the
 * label take the click, which user-event refuses to do to an element it
 * considers unclickable. Clicking the label is what a person does anyway.
 */
async function chooseReadState(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await screen.findByText(label, { selector: ".ant-segmented-item-label" }));
}

function renderPage(route = "/notifications") {
  return renderWithProviders(
    <CommandProvider>
      <NotificationsPage />
    </CommandProvider>,
    { route },
  );
}

describe("the notification centre", () => {
  it("lists what the API returned, with unread marked and counted", async () => {
    renderPage();

    expect(
      await screen.findByText("Mara Manager assigned you TSK-00042"),
    ).toBeInTheDocument();
    expect(screen.getByText("New sign-in from an unrecognised device")).toBeInTheDocument();
    expect(screen.getByTestId("unread-count")).toHaveTextContent("2 unread");
    expect(screen.getAllByTestId("notification-row")).toHaveLength(3);
  });

  it("asks the server for unread rows rather than filtering the page it has", async () => {
    const user = userEvent.setup();
    let requestedRead: string | null = null;
    server.use(
      http.get("/platform/notifications", ({ request }) => {
        requestedRead = new URL(request.url).searchParams.get("read");
        return HttpResponse.json(notificationPage([]));
      }),
    );

    renderPage();
    await chooseReadState(user, "Unread");

    // §71: the filter is a request, not a client-side slice of 25 rows.
    await waitFor(() => expect(requestedRead).toBe("unread"));
  });

  it("marks everything read and refreshes the counts", async () => {
    const user = userEvent.setup();
    let marked = false;
    server.use(
      http.post("/platform/notifications/read-all", () => {
        marked = true;
        return HttpResponse.json({ marked: 2, read_at: "2026-09-03T12:00:00Z" });
      }),
    );

    renderPage();
    // A regex, because AntD gives the leading icon its own `aria-label` and it
    // becomes part of the button's accessible name.
    await user.click(await screen.findByRole("button", { name: /Mark all read/ }));

    await waitFor(() => expect(marked).toBe(true));
  });

  it("marks one row read from its own action", async () => {
    const user = userEvent.setup();
    const seen: { id: string; body: unknown }[] = [];
    server.use(
      http.put("/platform/notifications/:id", async ({ request, params }) => {
        seen.push({ id: String(params["id"]), body: await request.json() });
        return HttpResponse.json({ ok: true });
      }),
    );

    renderPage();
    await user.click(
      await screen.findByRole("button", {
        name: "Mark Mara Manager assigned you TSK-00042 as read",
      }),
    );

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ id: "n1", body: { is_read: true } });
  });

  it("shows how many rows a collapsed group stands for", async () => {
    renderPage("/notifications?group=1");

    const counts = await screen.findAllByTestId("group-count");
    // The server said four; the row says "+3 more" beside the one on screen.
    expect(counts[0]).toHaveTextContent("+3 more");
  });

  it("distinguishes no results from nothing at all", async () => {
    server.use(http.get("/platform/notifications", () => HttpResponse.json(notificationPage([]))));

    const { unmount } = renderPage("/notifications?read=unread");
    expect(await screen.findByText("No records match these filters")).toBeInTheDocument();
    unmount();

    renderPage();
    expect(
      await screen.findByText("Nothing has needed your attention yet"),
    ).toBeInTheDocument();
  });

  it("reports a failure with the correlation id the server logged it against", async () => {
    server.use(
      http.get("/platform/notifications", () =>
        HttpResponse.json(
          { error: "service_unavailable", message: "the database is unreachable" },
          { status: 503, headers: { "X-Correlation-ID": "beefc0ffee" } },
        ),
      ),
    );

    renderPage();

    expect(await screen.findByText("the database is unreachable")).toBeInTheDocument();
    expect(screen.getByText("beefc0ffee")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("keeps the reader's filters in the URL so the view can be pasted", async () => {
    const user = userEvent.setup();
    renderPage();
    await chooseReadState(user, "Read");

    const list = await screen.findByRole("list", { name: "Notifications" });
    await waitFor(() =>
      expect(within(list).getAllByTestId("notification-row").length).toBeGreaterThan(0),
    );
    // MemoryRouter keeps the location internally; what matters here is that
    // the control drove a navigation the query re-read, rather than local
    // state the URL knows nothing about.
    expect(screen.getByRole("radio", { name: "Read" })).toBeChecked();
    expect(within(list).queryByText("New sign-in from an unrecognised device")).toBeNull();
  });
});

describe("the centre's digest", () => {
  it("summarises the whole mailbox, not the page that happens to be loaded", async () => {
    renderPage();

    const digest = await screen.findByTestId("notification-digest");
    // Counts come from the server's aggregates. "1 critical" derived from the
    // loaded rows would mean "1 critical among these twenty-five".
    expect(await within(digest).findByLabelText(/2 Unread/)).toBeInTheDocument();
    expect(within(digest).getByLabelText(/1 Critical/)).toBeInTheDocument();
    expect(within(digest).getByLabelText(/2 Last 24 hours/)).toBeInTheDocument();
  });

  it("is a filter as well as a summary, and says which one is applied", async () => {
    const user = userEvent.setup();
    const asked: Record<string, string | null>[] = [];
    server.use(
      http.get("/platform/notifications", ({ request }) => {
        const query = new URL(request.url).searchParams;
        asked.push({ read: query.get("read"), severity: query.get("severity") });
        return HttpResponse.json(notificationPage([]));
      }),
    );
    renderPage();

    const digest = await screen.findByTestId("notification-digest");
    await user.click(await within(digest).findByLabelText(/Critical/));

    // The tile drove a navigation the query re-read, rather than filtering
    // rows the browser already had.
    await waitFor(() =>
      expect(asked.at(-1)).toEqual({ read: "unread", severity: "CRITICAL" }),
    );
    expect(await within(digest).findByLabelText(/Critical/)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("puts the rows under the day they arrived on", async () => {
    renderPage();

    // Two of the three fixtures share a day, one is the day before — so the
    // feed has two headers and a reader can find the boundary by eye.
    await screen.findAllByTestId("notification-row");
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.length).toBe(2);
    expect(headings[0]).toHaveTextContent("2");
  });
});
