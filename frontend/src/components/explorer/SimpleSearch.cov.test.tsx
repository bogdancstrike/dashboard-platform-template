import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { STORAGE_KEYS } from "@/config";
import { renderWithProviders } from "@/test/render";

import { SimpleSearch } from "./SimpleSearch";

/**
 * The plain search box (§5): it remembers what was searched, per dataset,
 * offers it back, and lets a term be forgotten one at a time or all at once.
 */

const KEY = `${STORAGE_KEYS.recentSearches}.task`;

function Harness() {
  const [term, setTerm] = useState("");
  return (
    <>
      <SimpleSearch dataset="task" label="tasks" value={term} onChange={setTerm} />
      <output data-testid="term">{term}</output>
    </>
  );
}

const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as string[];

beforeEach(() => window.localStorage.clear());

describe("the simple search box", () => {
  it("remembers a term on Enter and on leaving the box", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const box = screen.getByLabelText("Search tasks");
    await user.type(box, "migration{Enter}");
    expect(stored()).toContain("migration");
    await user.clear(box);
    await user.type(box, "invoice");
    await user.tab();
    await waitFor(() => expect(stored()).toContain("invoice"));
  });

  it("offers recent terms back, and forgets one or all", async () => {
    window.localStorage.setItem(KEY, JSON.stringify(["alpha", "beta", "gamma"]));
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const box = screen.getByLabelText("Search tasks");
    await user.click(box);
    expect(await screen.findByText("Recent searches")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Forget beta" }));
    await waitFor(() => expect(stored()).not.toContain("beta"));

    await user.click(await screen.findByText("alpha"));
    await waitFor(() => expect(screen.getByTestId("term")).toHaveTextContent("alpha"));

    await user.clear(box);
    await user.click(box);
    await user.click(await screen.findByRole("button", { name: "Clear" }));
    await waitFor(() => expect(stored()).toEqual([]));
  });
});
