import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import AnnouncementsPage from "@/pages/AnnouncementsPage";
import { CommandProvider } from "@/commands/CommandContext";
import { announcements, resetAnnouncements } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

/**
 * The noticeboard (§17, §34).
 *
 * What is worth asserting is what makes a notice trustworthy: that expired
 * ones are not shown until asked for, that the strip counts only what is live,
 * that reading is recorded on arrival while acknowledging takes a decision,
 * and that an author sees states and reach a reader does not.
 */
function render(route = "/announcements") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/announcements" element={<AnnouncementsPage />} />
        <Route path="/settings/system" element={<div>the system page</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

afterEach(() => resetAnnouncements());

describe("the noticeboard", () => {
  it("shows what is current and keeps history one click away", async () => {
    const user = userEvent.setup();
    render();

    const board = await screen.findByTestId("announcement-board");
    expect(within(board).getByText("Scheduled maintenance this Sunday")).toBeInTheDocument();
    // A maintenance window that has passed is history: worth looking up, not
    // worth being shown every morning.
    expect(within(board).queryByText("Degraded search performance")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("announcement-history"));
    expect(await screen.findByText("Degraded search performance")).toBeInTheDocument();
  });

  it("counts only the live notices in the strip", async () => {
    render();

    // Three notices, one expired — so the strip totals two, and the expired
    // one's category reads zero rather than being absent.
    const strip = await screen.findByTestId("announcement-categories");
    expect(within(strip).getByText("2")).toBeInTheDocument();
    expect(screen.getByTestId("announcement-category-INCIDENT")).toBeDisabled();
    expect(screen.getByTestId("announcement-category-MAINTENANCE")).toBeEnabled();
  });

  it("records reading on arrival but never acknowledges by itself", async () => {
    render();

    await screen.findByTestId("announcement-board");
    // Marking on render is honest — the notice *was* on screen. Agreeing to a
    // policy is a decision, so it must not be a side effect of scrolling.
    await waitFor(() =>
      expect(announcements.find((item) => item["id"] === "notice-2")?.["read_at"]).not.toBeNull(),
    );
    expect(
      announcements.find((item) => item["id"] === "notice-2")?.["acknowledged_at"],
    ).toBeNull();
  });

  it("asks for agreement in words, and says so once it has it", async () => {
    const user = userEvent.setup();
    render();

    const button = await screen.findByTestId("acknowledge");
    // The button says what it commits the reader to, rather than "OK".
    expect(button).toHaveTextContent("I have read and understood this");

    await user.click(button);
    expect(await screen.findByText("Acknowledged")).toBeInTheDocument();
    expect(screen.queryByTestId("acknowledge")).not.toBeInTheDocument();
  });

  it("does not offer agreement on a notice that never asked for it", async () => {
    render();

    const board = await screen.findByTestId("announcement-board");
    const maintenance = within(board)
      .getByText("Scheduled maintenance this Sunday")
      .closest(".nu-notice") as HTMLElement;
    expect(within(maintenance).queryByTestId("acknowledge")).not.toBeInTheDocument();
  });

  it("gives an author the states and the reach a reader does not see", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("announcement-board");
    await user.click(screen.getByText("Authoring"));

    const table = await screen.findByTestId("announcement-authoring");
    // Derived states rather than stored ones: "Expired" is what the window
    // says, not a status a job swept.
    expect(within(table).getByText("Expired")).toBeInTheDocument();
    expect(within(table).getAllByText("Live").length).toBeGreaterThan(0);
    // And the author's question: how far did it get.
    expect(within(table).getAllByText(/12 read/).length).toBeGreaterThan(0);
    expect(within(table).getByText(/12 read · 4 agreed/)).toBeInTheDocument();
  });

  it("writes one through a drawer, because it is one object's fields", async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByTestId("new-announcement"));
    const drawer = await screen.findByRole("dialog");
    await user.type(within(drawer).getByLabelText("Title"), "Certificate rotation");
    await user.click(within(drawer).getByTestId("save-announcement"));

    await waitFor(() =>
      expect(announcements.some((item) => item["title"] === "Certificate rotation")).toBe(true),
    );
  });

});
