import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import FavoritesPage, {
  capacityNote,
  kindLabel,
  movedOrder,
} from "@/pages/FavoritesPage";
import type { Bookmark, BookmarkList } from "@/api/favorites";
import { CommandProvider } from "@/commands/CommandContext";
import { bookmarkRows, recentRows, resetFavorites } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * Favourites and recents (§38, §39).
 *
 * `movedOrder` is the page's one piece of real logic and is asserted directly:
 * it returns the **whole** order rather than a pair of positions, because the
 * server takes one list — applying a drag as a series of single moves is how
 * two moves end up fighting over one position — and a move off either end
 * returns the order unchanged rather than wrapping, because wrapping sends the
 * top item to the bottom on a mis-click.
 *
 * `capacityNote` is the sentence that replaces a fraction. "3 / 100" makes a
 * reader work out whether that is a problem; the sentence says.
 *
 * Through the page: that the two lists stay apart, that the order is not
 * sortable, that a recent already kept shows as kept rather than offering to
 * keep it again, and that clearing the trail says the bookmarks survive.
 */
function render(route = "/favorites") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/favorites" element={<FavoritesPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

afterEach(() => {
  resetFavorites();
});

const asBookmark = (overrides: Partial<Bookmark>): Bookmark =>
  ({
    id: "b",
    resource_type: "ticket",
    resource_id: "t",
    label: "A thing",
    url: "/tickets/t",
    icon: null,
    position: 1,
    added_at: null,
    ...overrides,
  });

const asList = (overrides: Partial<BookmarkList>): BookmarkList =>
  ({
    items: [],
    total: 0,
    maximum: 100,
    kinds: [],
    bookmarkable: [],
    ...overrides,
  });

describe("moving one bookmark", () => {
  const items = [
    asBookmark({ id: "one", position: 1 }),
    asBookmark({ id: "two", position: 2 }),
    asBookmark({ id: "three", position: 3 }),
  ];

  it("returns the whole order, not a pair of positions", () => {
    // The server takes one list, because two single moves would fight over
    // one position.
    expect(movedOrder(items, "three", -1)).toEqual(["one", "three", "two"]);
    expect(movedOrder(items, "one", 1)).toEqual(["two", "one", "three"]);
  });

  it("leaves the order alone at either end rather than wrapping", () => {
    // Wrapping sends the top item to the bottom on a mis-click.
    expect(movedOrder(items, "one", -1)).toEqual(["one", "two", "three"]);
    expect(movedOrder(items, "three", 1)).toEqual(["one", "two", "three"]);
  });

  it("leaves the order alone for something not in it", () => {
    expect(movedOrder(items, "nowhere", -1)).toEqual(["one", "two", "three"]);
  });
});

describe("how full the list is", () => {
  it("says it in a sentence rather than a fraction", () => {
    // "3 / 100" makes a reader work out whether that is a problem.
    expect(
      capacityNote(asList({ total: 3, kinds: [{ key: "ticket", count: 3 }] })),
    ).toContain("all of one kind");
    expect(
      capacityNote(
        asList({
          total: 5,
          kinds: [
            { key: "ticket", count: 3 },
            { key: "report", count: 2 },
          ],
        }),
      ),
    ).toContain("across 2 kinds");
  });

  it("says what to do when it is full", () => {
    const said = capacityNote(
      asList({ total: 100, maximum: 100, kinds: [{ key: "ticket", count: 100 }] }),
    );
    expect(said).toContain("that is the limit");
    expect(said).toContain("Remove one");
  });

  it("says nothing is kept rather than showing a zero", () => {
    expect(capacityNote(asList({}))).toBe("Nothing kept yet.");
  });
});

describe("naming a kind", () => {
  it("derives the label from the type, so a new one needs no map", () => {
    // The bookmarkable types come from the platform's registry, and a
    // hand-kept map would be missing whichever was added last.
    expect(kindLabel("saved_search")).toBe("Saved search");
    expect(kindLabel("ticket")).toBe("Ticket");
    expect(kindLabel("dashboard")).toBe("Dashboard");
  });
});

describe("the two lists", () => {
  it("keeps them apart, so a decision does not read as a by-product", async () => {
    render();
    expect(await screen.findByTestId("bookmarks-table")).toBeInTheDocument();
    expect(screen.getByTestId("recents-table")).toBeInTheDocument();
    expect(screen.getByTestId("bookmarks-card")).toHaveTextContent("Kept");
    expect(screen.getByTestId("recents-card")).toHaveTextContent("Looked at lately");
  });

  it("shows bookmarks of several kinds, which the old design could not", async () => {
    render();
    const table = await screen.findByTestId("bookmarks-table");
    // A report and a saved search on the favourites page is the whole point
    // of there being one store (§38).
    await waitFor(() => expect(within(table).getByText("Report")).toBeInTheDocument());
    expect(within(table).getByText("Saved search")).toBeInTheDocument();
    expect(within(table).getByText("Ticket")).toBeInTheDocument();
  });

  it("opens what a bookmark points at", async () => {
    render();
    const link = await screen.findByTestId("open-fav-report");
    // The stored address, so it survives a rename and a router change.
    expect(link).toHaveAttribute("href", "/reports/r-1");
  });

  it("offers no way to sort the kept list", async () => {
    render();
    const table = await screen.findByTestId("bookmarks-table");
    // The order *is* the information, so "sort by name" would invite
    // somebody to destroy the arrangement they made.
    expect(table.querySelectorAll("th.ant-table-column-has-sorters")).toHaveLength(0);
  });

  it("says how full it is in words", async () => {
    render();
    expect(await screen.findByTestId("capacity")).toHaveTextContent("across 3 kinds");
  });
});

describe("arranging them", () => {
  it("moves one down and sends the whole order", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("bookmarks-table");

    await user.click(await screen.findByTestId("down-fav-ticket"));

    await waitFor(() =>
      expect(bookmarkRows.find((row) => row["id"] === "fav-ticket")?.["position"]).toBe(2),
    );
    expect(bookmarkRows.find((row) => row["id"] === "fav-report")?.["position"]).toBe(1);
  });

  it("disables the move at either end", async () => {
    render();
    await screen.findByTestId("bookmarks-table");
    // Nothing above the first and nothing below the last, rather than a
    // button that wraps.
    expect(await screen.findByTestId("up-fav-ticket")).toBeDisabled();
    expect(screen.getByTestId("down-fav-search")).toBeDisabled();
  });

  it("cannot rearrange while showing one kind, and says why", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("bookmarks-table");

    // The label, not the radio: AntD's Segmented puts `pointer-events: none`
    // on the input.
    await user.click(
      await screen.findByText(/^Report \(1\)$/, { selector: ".ant-segmented-item-label" }),
    );

    // The arrangement is of the whole list, so moving within a filtered view
    // would produce an order the reader did not ask for.
    expect(await screen.findByTestId("filter-note")).toHaveTextContent(
      "arrangement is of the whole list",
    );
    expect(screen.getByTestId("down-fav-report")).toBeDisabled();
  });
});

describe("keeping and unkeeping", () => {
  it("unstars one, and it leaves the list", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("bookmarks-table");

    await user.click(await screen.findByTestId("unstar-fav-report"));

    await waitFor(() =>
      expect(bookmarkRows.some((row) => row["id"] === "fav-report")).toBe(false),
    );
  });

  it("keeps one of the recents, which is how most bookmarks are made", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("recents-table");

    await user.click(await screen.findByTestId("keep-rec-new"));

    await waitFor(() =>
      expect(bookmarkRows.some((row) => row["resource_id"] === "c-9")).toBe(true),
    );
  });

  it("shows an already-kept recent as kept rather than offering it again", async () => {
    render();
    await screen.findByTestId("recents-table");
    // The row already knows, so no request is needed to find out — and
    // unstarring belongs in the list that owns the arrangement.
    expect(await screen.findByLabelText("Printer on fire is kept")).toBeInTheDocument();
    expect(screen.queryByTestId("keep-rec-kept")).not.toBeInTheDocument();
  });
});

describe("forgetting the trail", () => {
  it("says the bookmarks survive, because 'clear' beside two lists is frightening", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("recents-table");

    await user.click(screen.getByTestId("clear-recents"));
    expect(await screen.findByText(/favourites are untouched/)).toBeInTheDocument();
    // And that it is all or nothing: one entry removed from a trail leaves a
    // misleading one.
    expect(screen.getByText(/whole trail goes/)).toBeInTheDocument();
  });

  it("clears the trail and leaves the bookmarks", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("recents-table");

    await user.click(screen.getByTestId("clear-recents"));
    await user.click(await screen.findByRole("button", { name: "Forget it" }));

    await waitFor(() => expect(recentRows).toHaveLength(0));
    expect(bookmarkRows.length).toBeGreaterThan(0);
  });

  it("offers nothing to forget when there is nothing", async () => {
    server.use(
      http.get("/platform/recents", () =>
        HttpResponse.json({ items: [], total: 0, kept: 50 }),
      ),
    );
    render();
    await waitFor(() => expect(screen.getByTestId("clear-recents")).toBeDisabled());
  });
});

describe("the empty states", () => {
  it("says how a bookmark is made, rather than 'no data'", async () => {
    server.use(
      http.get("/platform/favorites", () =>
        HttpResponse.json({
          items: [],
          total: 0,
          maximum: 100,
          kinds: [],
          bookmarkable: [],
        }),
      ),
    );
    render();
    // The state a new account is in, and the one worth writing for.
    expect(
      await screen.findByText(/Star a record, a report or a saved search/),
    ).toBeInTheDocument();
  });

  it("says what would appear in the trail", async () => {
    server.use(
      http.get("/platform/recents", () =>
        HttpResponse.json({ items: [], total: 0, kept: 50 }),
      ),
    );
    render();
    expect(
      await screen.findByText(/Records, reports and saved searches you open appear here/),
    ).toBeInTheDocument();
  });
});
