import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import { CommandPalette, recordAddress } from "@/components/CommandPalette";
import { CommandProvider, useCommands, usePageCommands } from "@/commands/CommandContext";
import { globalHits } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The palette reaches records, not only pages (§31, §32).
 *
 * Its own docstring said records were "later" for the life of the project,
 * which made the palette a navigation menu with a fuzzy match — and the thing
 * somebody actually wants from `Ctrl-K` is "TSK-00042, enter, be there".
 *
 * Two claims are worth the reader's attention:
 *
 * **A record goes to its own page when there is one.** `/files` and
 * `/admin/users` list records the router serves no `:id` route for, so those
 * open in the explorer narrowed to the record — sending somebody to a 404
 * would be worse than a filtered list.
 *
 * **The server's matches are not filtered again.** `cmdk` fuzzy-matches every
 * item against the same term the server already matched on, and its match on
 * a label like "REC-00031" hides a row that matched on a description.
 */

function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function Page() {
  const { setOpen } = useCommands();
  usePageCommands("probe", [
    { id: "probe.act", label: "Do the page's thing", run: () => setOpen(false) },
  ]);
  return <button onClick={() => setOpen(true)}>open the palette</button>;
}

function render(route = "/tasks") {
  return renderWithProviders(
    <CommandProvider>
      <Address />
      <CommandPalette />
      <Routes>
        <Route path="/tasks" element={<Page />} />
        <Route path="/tasks/:id" element={<div>the task page</div>} />
        <Route path="/explore" element={<div>the explorer</div>} />
        <Route path="/orders" element={<div>the ledger</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

/** Render the page, then open the palette from it, as a reader does. */
async function openPalette(route = "/tasks") {
  const user = userEvent.setup();
  render(route);
  await user.click(await screen.findByText("open the palette"));
  await screen.findByPlaceholderText(/Search pages, records and actions/);
  return user;
}

describe("the palette", () => {
  it("offers the current page's own actions first", async () => {
    await openPalette();
    // "On this page" is the group a page contributes, and the heading names
    // where the reader is rather than saying "Page".
    expect(await screen.findByText("Do the page's thing")).toBeInTheDocument();
  });

  it("navigates to a destination", async () => {
    const user = await openPalette();
    await user.type(screen.getByPlaceholderText(/Search pages/), "orders");
    await user.click(await screen.findByText("Orders"));

    expect(await screen.findByText("the ledger")).toBeInTheDocument();
  });

  it("finds records once two letters are typed, and opens the record's page", async () => {
    server.use(
      http.get("/platform/api/search/global", () => HttpResponse.json(globalHits)),
    );
    const user = await openPalette();

    await user.type(screen.getByPlaceholderText(/Search pages/), "migration");

    const hit = await screen.findByText("TSK-00042");
    // The dataset and the field that matched, beside the label: a ranked list
    // drawn from six tables is unreadable without them.
    expect(screen.getByText(/Tasks · Title/)).toBeInTheDocument();
    await user.click(hit);

    expect(await screen.findByText("the task page")).toBeInTheDocument();
    expect(screen.getByTestId("address")).toHaveTextContent("/tasks/task-1");
  });

  it("sends a record whose dataset has no page to the explorer", async () => {
    server.use(
      http.get("/platform/api/search/global", () => HttpResponse.json(globalHits)),
    );
    const user = await openPalette();
    await user.type(screen.getByPlaceholderText(/Search pages/), "migration");

    await user.click(await screen.findByText("migration-plan.pdf"));

    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent(
        "/explore?resource=file&f.id=file-1",
      ),
    );
  });

  it("asks the server nothing for a single letter", async () => {
    const asked: string[] = [];
    server.use(
      http.get("/platform/api/search/global", ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("q") ?? "");
        return HttpResponse.json(globalHits);
      }),
    );
    const user = await openPalette();
    const box = screen.getByPlaceholderText(/Search pages/);

    await user.type(box, "m");
    await user.type(box, "igration");

    // Asserted by what *was* asked rather than by waiting to see nothing: the
    // single letter never reaches the server, because one letter matches most
    // of a database and the answer would be discarded by the next keystroke.
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked).not.toContain("m");
    expect(asked[asked.length - 1]).toBe("migration");
  });

  it("forgets the last search when it reopens", async () => {
    const user = await openPalette();
    await user.type(screen.getByPlaceholderText(/Search pages/), "orders");
    await user.keyboard("{Escape}");

    await user.click(screen.getByText("open the palette"));

    // A palette that reopens showing the last search answers the previous
    // question.
    expect(await screen.findByPlaceholderText(/Search pages/)).toHaveValue("");
  });
});

describe("where a record opens", () => {
  it("is its own page for a dataset the router serves one for", () => {
    expect(
      recordAddress(
        { resource_type: "order", id: "order-9" } as never,
        "/orders",
      ),
    ).toBe("/orders/order-9");
  });

  it("is the explorer, narrowed, for one it does not", () => {
    expect(
      recordAddress({ resource_type: "file", id: "file-9" } as never, "/files"),
    ).toBe("/explore?resource=file&f.id=file-9");
  });
});
