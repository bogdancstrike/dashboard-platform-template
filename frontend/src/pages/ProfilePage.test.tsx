import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";
import { Route, Routes, useSearchParams } from "react-router-dom";

import ProfilePage, {
  TABS,
  heatmapPanel,
  tabFrom,
  throughputPanel,
  whereTheySit,
} from "@/pages/ProfilePage";
import type { Profile } from "@/api/profile";
import { CommandProvider } from "@/commands/CommandContext";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * The reader's own page, and a colleague's (§40, §41).
 *
 * The claims:
 *
 * **It answers "why can I not export?"** The access tab shows the effective
 * permission set and marks the ones a *group* granted rather than the role —
 * which was, until this page, visible only on a screen the asker cannot open.
 *
 * **A colleague's page names what it is not showing.** A panel that is empty
 * for want of permission is indistinguishable from a panel that is broken, so
 * the withholding is drawn (§76).
 *
 * **The tab is in the URL.** A tab that resets on reload is a tab nobody can
 * link to (§69).
 *
 * **The charts get the empty buckets.** Every week has a bar and every hour a
 * cell — a chart drawn only where there is data reports a quiet week as no
 * week at all.
 */

/**
 * The router's own address, echoed into the DOM.
 *
 * `window.location` is not it: the suite renders inside a `MemoryRouter`, so
 * asserting on the browser's URL asserts on the page the test file was loaded
 * from. The first version of the tab test did exactly that and compared an
 * empty string against `tab=access` forever.
 */
function Address() {
  const [params] = useSearchParams();
  return <span data-testid="address">{params.toString()}</span>;
}

function render(route = "/profile") {
  return renderWithProviders(
    <CommandProvider>
      <Address />
      <Routes>
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/:userId" element={<ProfilePage />} />
        <Route path="/settings/preferences" element={<div>the preferences page</div>} />
        <Route path="/tasks" element={<div>the task list</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

/**
 * A profile the *server* has withheld half of.
 *
 * Overridden on the profile endpoint rather than by stripping the reader's
 * permissions on `/api/me`: visibility is the server's decision and arrives
 * in the payload, so a fixture that changes the reader's permissions is
 * testing a rule this page does not implement. The first version did that and
 * asserted a withholding notice that never came.
 */
function withheldProfile() {
  server.use(
    http.get("/platform/api/profile/:userId?", () =>
      HttpResponse.json({
        is_me: false,
        user: {
          id: "00000000-0000-0000-0000-0000000000ff",
          full_name: "Mara Manager",
          initials: "MM",
          username: "manager",
          avatar_url: null,
          job_title: "Delivery Manager",
          status: "ACTIVE",
        },
        role: { code: "MANAGER", name: "Manager", color: "", description: "" },
        organization: { id: "org-1", name: "Northwind Partners" },
        department: null,
        team: null,
        manager: null,
        joined_at: "2024-02-01T09:00:00Z",
        last_login_at: null,
        login_count: null,
        locale: "en-GB",
        timezone: "Europe/Bucharest",
        mfa_enabled: false,
        visibility: { contact: false, access: false, activity: false },
        groups: [],
        access: null,
        stats: [],
        throughput: [],
        heatmap: [],
        touches: [],
      }),
    ),
  );
}

describe("the pure parts", () => {
  it("keeps a tab in the URL and falls back to the overview", () => {
    expect(tabFrom("access")).toBe("access");
    expect(tabFrom("activity")).toBe("activity");
    // Not an error and not a blank page: an address somebody mistyped should
    // open the page rather than nothing.
    expect(tabFrom("nonsense")).toBe("overview");
    expect(tabFrom(null)).toBe("overview");
  });

  it("has three tabs, and deliberately not five", () => {
    // Preferences and security are whole pages at their own addresses.
    // Re-hosting either here would put one screen at two addresses, which is
    // two things to keep in step and a bookmark that points at whichever a
    // reader happened to find.
    expect([...TABS]).toEqual(["overview", "activity", "access"]);
  });

  it("reads where somebody sits, and says so when they sit nowhere", () => {
    const base = {
      role: { code: null, name: "", color: "", description: "" },
      department: null,
      organization: null,
    } as unknown as Profile;
    expect(whereTheySit(base)).toBe("No role assigned");
    expect(
      whereTheySit({
        ...base,
        role: { code: "M", name: "Manager", color: "", description: "" },
        organization: { id: "o", name: "Northwind" },
      }),
    ).toBe("Manager · Northwind");
  });

  it("draws every cell of the heatmap, including the empty ones", () => {
    const profile = {
      heatmap: [{ day: 0, hour: 9, value: 3 }],
    } as unknown as Profile;
    const panel = heatmapPanel(profile);
    // Hours across and weekdays down, Monday first — the axes are declared, so
    // a quiet Sunday is a row of empty cells rather than a missing row.
    expect(panel.groups).toHaveLength(24);
    expect(panel.categories).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(panel.series[0]).toEqual({ name: "Mon", group: "09", value: 3 });
  });

  it("keeps the weeks in the order the server sent them", () => {
    const profile = {
      throughput: [
        { bucket: "2026-06-01T00:00:00Z", value: 2 },
        { bucket: "2026-06-08T00:00:00Z", value: 0 },
      ],
    } as unknown as Profile;
    const panel = throughputPanel(profile);
    expect(panel.series.map((point) => point.name)).toEqual(["2026-06-01", "2026-06-08"]);
    // The empty week is drawn. Dropping it would put a straight line through a
    // fortnight and report steady output where there was none.
    expect(panel.series[1]!.value).toBe(0);
  });
});

describe("your own page", () => {
  it("leads with who you are and where you sit", async () => {
    render();
    expect(await screen.findByRole("heading", { name: /Ada Administrator/ })).toBeInTheDocument();
    const identity = screen.getByTestId("profile-identity");
    expect(within(identity).getByText("Platform Administrator")).toBeInTheDocument();
    expect(within(identity).getByText(/Europe\/Bucharest/)).toBeInTheDocument();
  });

  it("opens the rows behind every count", async () => {
    const user = userEvent.setup();
    render();
    const stats = await screen.findByTestId("profile-stats");
    // A number nobody can click is a number nobody can check (§44).
    const links = within(stats).getAllByRole("link");
    expect(links.length).toBe(5);
    expect(links[0]).toHaveAttribute("href", expect.stringContaining("/tasks?f.assignee_id="));

    await user.click(links[0]!);
    expect(await screen.findByText("the task list")).toBeInTheDocument();
  });

  it("digests the two settings pages rather than copying them", async () => {
    render();
    const digests = await screen.findByTestId("profile-digests");
    // What the pages would say, in a sentence each, with a way through.
    expect(within(digests).getByText(/theme/)).toBeInTheDocument();
    expect(within(digests).getByRole("link", { name: "Change" })).toHaveAttribute(
      "href",
      "/settings/preferences",
    );
    expect(within(digests).getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      "/settings/security",
    );
  });

  it("shows no withholding notice about yourself", async () => {
    render();
    await screen.findByTestId("profile-identity");
    expect(screen.queryByTestId("profile-withheld")).not.toBeInTheDocument();
  });
});

describe("the access tab", () => {
  it("marks the permissions a group granted rather than the role", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("profile-identity");

    await user.click(screen.getByRole("tab", { name: "Access" }));
    const access = await screen.findByTestId("profile-access");
    // Twice as a tag on purpose: once in the effective set and once under the
    // group that grants it, which is the pairing that answers the question.
    // (The summary notice at the bottom names it a third time, so this counts
    // tags rather than occurrences.)
    const tags = within(access)
      .getAllByText("records.export")
      .filter((node) => node.className.includes("ant-tag"));
    expect(tags).toHaveLength(2);
    // And marked, so the effective list itself says which came from a group —
    // a page showing only the role cannot answer "why can they do that?".
    expect(tags.some((tag) => tag.className.includes("ant-tag-processing"))).toBe(true);
    expect(screen.getByTestId("profile-from-groups")).toHaveTextContent("records.export");
    expect(within(access).getByText("Platform owners")).toBeInTheDocument();
  });

  it("puts the tab in the URL so it can be linked", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("profile-identity");

    await user.click(screen.getByRole("tab", { name: "Access" }));
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("tab=access"),
    );

    // And back to the overview clears it rather than writing `tab=overview`:
    // the default belongs in no URL.
    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent(""));
  });

  it("opens straight onto the tab an address names", async () => {
    render("/profile?tab=access");
    expect(await screen.findByTestId("profile-access")).toBeInTheDocument();
  });
});

describe("a colleague's page", () => {
  it("says what it is not showing", async () => {
    withheldProfile();
    render("/profile/00000000-0000-0000-0000-0000000000ff");

    expect(await screen.findByRole("heading", { name: /Mara Manager/ })).toBeInTheDocument();
    // Drawn rather than hidden: an empty panel is indistinguishable from a
    // broken one (§76).
    expect(screen.getByTestId("profile-withheld")).toHaveTextContent("users.view");
    expect(screen.queryByTestId("profile-digests")).not.toBeInTheDocument();
  });

  it("explains an absent access tab instead of leaving it blank", async () => {
    withheldProfile();
    const user = userEvent.setup();
    render("/profile/00000000-0000-0000-0000-0000000000ff");
    await screen.findByTestId("profile-identity");

    await user.click(screen.getByRole("tab", { name: "Access" }));
    expect(await screen.findByText("Their access is not shown")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Activity" }));
    // And the reason, which is a real one: a per-person list of everything
    // somebody did is the audit log.
    expect(await screen.findByText("Their activity is not shown")).toBeInTheDocument();
  });
});

describe("when it cannot be loaded", () => {
  it("says so rather than rendering an empty shell", async () => {
    server.use(
      http.get("/platform/api/profile/:userId?", () =>
        HttpResponse.json({ error: "not_found", message: "gone" }, { status: 404 }),
      ),
    );
    render("/profile/00000000-0000-0000-0000-0000000000aa");
    expect(await screen.findByText("That page could not be loaded")).toBeInTheDocument();
  });
});
