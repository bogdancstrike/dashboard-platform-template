import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { STORAGE_KEYS } from "@/config";
import { ExplorerSearch } from "@/components/explorer/ExplorerSearch";
import { globalHits } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The explorer's search box (§5, §31): this dataset's own history, matches in
 * the other datasets, and a way to every match — one dropdown, three kinds of
 * entry.
 */
function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ExplorerSearch dataset="task" label="tasks" value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
      <Where />
    </>
  );
}

const box = () => screen.getByRole("combobox", { name: "Search tasks" });

beforeEach(() => {
  window.localStorage.setItem(`${STORAGE_KEYS.recentSearches}.task`, JSON.stringify(["migration", "invoice", "Ünïcode"]));
});

describe("this dataset's history", () => {
  it("offers recent searches, picks one, forgets one and clears them all", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(box());
    expect(await screen.findByText("Recent searches")).toBeInTheDocument();
    await user.click(screen.getByText("invoice"));
    expect(screen.getByTestId("value")).toHaveTextContent("invoice");

    await user.clear(box());
    await user.click(screen.getByRole("button", { name: "Forget Ünïcode" }));
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(`${STORAGE_KEYS.recentSearches}.task`) ?? "[]")).not.toContain("Ünïcode"),
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(window.localStorage.getItem(`${STORAGE_KEYS.recentSearches}.task`)).toBe("[]");
  });

  it("remembers what was searched when Enter is pressed", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem(`${STORAGE_KEYS.recentSearches}.task`);
    renderWithProviders(<Harness initial="overdue" />);
    await user.click(box());
    await user.keyboard("{Enter}");
    expect(JSON.parse(window.localStorage.getItem(`${STORAGE_KEYS.recentSearches}.task`) ?? "[]")).toContain("overdue");
  });
});

describe("matches everywhere else", () => {
  beforeEach(() => {
    server.use(http.get("/platform/api/search/global", () => HttpResponse.json({ ...globalHits, groups: [...globalHits.groups, { ...globalHits.groups[1], resource_type: "ticket", label: "Tickets", has_more: true }] })));
  });

  it("lists other datasets' matches, never this one's, and opens one in the explorer", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    fireEvent.change(box(), { target: { value: "migration" } });
    expect(await screen.findByText("Files", {}, { timeout: 3000 })).toBeInTheDocument();
    // The tasks group is the rows behind the dropdown, so it is not repeated.
    expect(screen.queryByText("TSK-00042")).not.toBeInTheDocument();
    expect(screen.getByText("top matches")).toBeInTheDocument();
    await user.click(screen.getAllByText("plan.pdf", { exact: false })[0]!);
    expect(screen.getByTestId("where")).toHaveTextContent("/explore?resource=file&f.id=file-1");
  });

  it("goes to every match from the last entry", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    fireEvent.change(box(), { target: { value: "migration" } });
    await user.click(await screen.findByText("See every match for “migration”", {}, { timeout: 3000 }));
    expect(screen.getByTestId("where")).toHaveTextContent("/find/global?q=migration");
  });
});
