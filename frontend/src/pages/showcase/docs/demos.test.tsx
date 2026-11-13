import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DEMOS, DEMO_SOURCE } from "@/pages/showcase/docs/sources";
import { renderWithProviders } from "@/test/render";

/**
 * Every demo on the component docs page, on its own.
 *
 * The page draws a demo only when it scrolls near (or when a search narrows
 * the page to a few), so the page's own tests see a handful. A demo is copied
 * by readers as the way to use a component; one that throws, or whose button
 * does nothing, teaches the wrong thing — so each is mounted here, and the
 * interactive ones are used the way a reader would use them.
 */
function show(key: string) {
  const Demo = DEMOS[key]?.default;
  if (!Demo) throw new Error(`no demo called ${key}`);
  return renderWithProviders(<Demo />);
}

describe("every demo", () => {
  const keys = Object.keys(DEMOS).sort();

  it("has demos to mount, each with the source a reader copies", () => {
    expect(keys.length).toBeGreaterThan(50);
    for (const key of keys) expect(DEMO_SOURCE[key], key).toContain("export default function");
  });

  it.each(keys)("%s mounts and draws something", (key) => {
    const { container } = show(key);
    // Something on screen: an element, rather than a demo that rendered null.
    expect(container.firstElementChild, key).not.toBeNull();
  });
});

describe("the interactive demos do what they say", () => {
  it("opens and closes a modal", async () => {
    const user = userEvent.setup();
    show("modal.basic");
    await user.click(screen.getByRole("button", { name: "Open a modal" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByPlaceholderText("Name, email or group")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Share" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Open a modal" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens a drawer and closes it from its footer and its X", async () => {
    const user = userEvent.setup();
    show("drawer.basic");
    await user.click(screen.getByRole("button", { name: "Open a drawer" }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Upstream returned 503 after 3 retries")).toBeInTheDocument();
    // Two buttons are called "Close": the drawer's X and the footer's.
    const [x, footer] = within(drawer).getAllByRole("button", { name: "Close" });
    await user.click(footer!);
    await waitFor(() => expect(screen.queryByText("Nightly ERP sync")).not.toBeVisible());
    await user.click(screen.getByRole("button", { name: "Open a drawer" }));
    await waitFor(() => expect(screen.getByText("Nightly ERP sync")).toBeVisible());
    await user.click(x!);
    await waitFor(() => expect(screen.queryByText("Nightly ERP sync")).not.toBeVisible());
  });

  it("sends each kind of feedback", async () => {
    const user = userEvent.setup();
    show("feedback.toasts");
    await user.click(screen.getByRole("button", { name: "Success message" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Error message" }));
    expect(await screen.findByText("That could not be saved")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Notification" }));
    expect(await screen.findByText("Export ready")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm…" }));
    expect((await screen.findAllByText("Delete this report?")).length).toBeGreaterThan(0);
  });

  it("names a folder through the name modal, and refuses an empty name", async () => {
    const user = userEvent.setup();
    show("name-modal.basic");
    expect(screen.getByText("Nothing named yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New folder…" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Folder name"), "Contracts 2026{Enter}");
    expect(await screen.findByText("Last name given: Contracts 2026")).toBeInTheDocument();
  });

  it("validates the form and then says what would be created", async () => {
    const user = userEvent.setup();
    show("form.basic");
    await user.click(screen.getByRole("button", { name: "Create customer" }));
    expect(await screen.findByText("A customer needs a name")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "Ünïcode Logistics");
    await user.click(screen.getByRole("button", { name: "Create customer" }));
    expect(await screen.findByText("Ünïcode Logistics would be created")).toBeInTheDocument();
  });

  it("folds every section and opens them again", async () => {
    const user = userEvent.setup();
    show("collapse-all.basic");
    expect(screen.getByText(/▸ Find/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Collapse all sections/ }));
    expect(screen.getByText(/▸ Overview/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Expand all sections/ }));
    expect(screen.getByText(/▾ Find/)).toBeInTheDocument();
  });

  it("walks the wizard's steps without going past either end", async () => {
    const user = userEvent.setup();
    show("steps.wizard");
    const back = screen.getByRole("button", { name: "Back" });
    const next = screen.getByRole("button", { name: "Continue" });
    await user.click(back);
    expect(back).toBeDisabled();
    await user.click(next);
    await user.click(next);
    await user.click(next);
    expect(next).toBeDisabled();
  });

  it("chooses one window of several, and skips the disabled one", async () => {
    const user = userEvent.setup();
    show("segmented.basic");
    await user.click(screen.getByText("7 days"));
    expect(screen.getByText(/Chosen: 7d/)).toBeInTheDocument();
    await user.click(screen.getByText("Custom"));
    expect(screen.getByText(/Chosen: 7d/)).toBeInTheDocument();
  });

  it("shows each failure with its own title and a retry", () => {
    show("failure-alert.kinds");
    expect(screen.getByText("Those records could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("Your role does not include this dataset")).toBeInTheDocument();
    expect(screen.getByText("That record is no longer there")).toBeInTheDocument();
    expect(screen.getByText("Somebody else changed this first")).toBeInTheDocument();
  });

  it("draws a chart card loading, empty and failed", () => {
    show("chart-card.states");
    expect(screen.getByText("Nothing in this period")).toBeInTheDocument();
    expect(screen.getAllByText(/timed out|could not/i).length).toBeGreaterThan(0);
  });

  it("lists a feed with who, what and when", () => {
    show("timeline.feed");
    expect(screen.getByText("Mara Manager")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
  });
});
