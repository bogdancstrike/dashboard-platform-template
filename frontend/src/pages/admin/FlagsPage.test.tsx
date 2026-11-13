/**
 * `/admin/flags` (§27): grouped by area, searchable, turning a gating flag off
 * is confirmed with exactly what disappears, preview-as a role, and a drawer
 * with rollout + targeting, what the flag controls and its history.
 */

import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import FlagsPage, { ControlsList, blastRadius, reachOf } from "@/pages/admin/FlagsPage";
import type { FeatureFlag, FlagControls } from "@/api/settings";
import { currentUser, flagRows, resetFlags } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

function renderPage(route = "/admin/flags") {
  server.use(
    http.get("/platform/api/me", () =>
      HttpResponse.json({ ...currentUser, permissions: [...currentUser.permissions, "flags.manage"] }),
    ),
    http.get("/platform/meta/roles", () =>
      HttpResponse.json({
        items: [
          { code: "ADMINISTRATOR", name: "Administrator", description: "", rank: 1, color: "", permissions: [] },
          { code: "VIEWER", name: "Viewer", description: "", rank: 5, color: "", permissions: [] },
        ],
        total: 2,
      }),
    ),
  );
  return renderWithProviders(
    <Routes>
      <Route path="/admin/flags" element={<FlagsPage />} />
    </Routes>,
    { route },
  );
}

afterEach(() => resetFlags());

const controls: FlagControls = {
  routes: ["/time"],
  nav: ["/time"],
  components: ["Timer pill in the header"],
  endpoints: [{ methods: ["GET"], url: "/api/time/week" }],
  jobs: ["work.recurring-tasks"],
  live: ["*"],
  payload_rules: ["a schedule refuses"],
  dependents: ["workflow-canvas"],
};

describe("what a flag takes away", () => {
  it("counts it", () => {
    expect(blastRadius(undefined)).toEqual([]);
    expect(blastRadius(controls)).toEqual([
      "1 page", "1 component", "1 API endpoint", "1 background job", "1 dependent flag",
    ]);
  });

  it("lists it, and says so when nothing reads the flag", () => {
    rtlRender(<ControlsList controls={controls} names={{ "workflow-canvas": "Workflow canvas" }} />);
    const list = screen.getByTestId("flag-controls");
    expect(within(list).getByText("GET /api/time/week")).toBeInTheDocument();
    expect(within(list).getByText("the whole live channel")).toBeInTheDocument();
    expect(within(list).getByText("Workflow canvas")).toBeInTheDocument();
    rtlRender(<ControlsList controls={undefined} names={{}} />);
    expect(screen.getByText(/installation's own/)).toBeInTheDocument();
  });

  it("describes group and organization targeting in the reach", () => {
    const flag = {
      enabled: true, rollout_percentage: 0, target_roles: [], target_user_ids: [],
      target_group_ids: ["g"], target_organization_ids: ["o1", "o2"],
    } as unknown as FeatureFlag;
    expect(reachOf(flag)).toBe("Only 1 group, 2 organizations");
  });
});

describe("the flags page", () => {
  it("groups the flags by area", async () => {
    renderPage();
    const work = await screen.findByTestId("flag-group-work");
    expect(within(work).getByText("Time tracking")).toBeInTheDocument();
    expect(within(screen.getByTestId("flag-group-data")).getByText("CSV import wizard")).toBeInTheDocument();
    // A flag with no area is an installation's own.
    expect(within(screen.getByTestId("flag-group-custom")).getByText("Dark mode")).toBeInTheDocument();
  });

  it("narrows by search, and by the rolling-out state", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("flag-group-work");
    await user.type(screen.getByLabelText("Search flags"), "timer{Enter}");
    await waitFor(() => expect(screen.queryByTestId("flag-group-data")).not.toBeInTheDocument());

    renderPage("/admin/flags?state=PARTIAL");
    await waitFor(() => expect(screen.getAllByText("CSV import wizard").length).toBeGreaterThan(0));
  });

  it("says nothing matches when nothing does", async () => {
    renderPage("/admin/flags?q=zzzz");
    expect(await screen.findByText("No flag matches")).toBeInTheDocument();
  });

  it("confirms turning a gating flag off, listing what disappears", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("flag-group-work");
    await user.click(screen.getByRole("switch", { name: "Turn off Time tracking" }));

    const dialog = await screen.findByRole("dialog", { name: "Turn off Time tracking?" });
    expect(within(dialog).getByText("/api/time/timer", { exact: false })).toBeInTheDocument();
    expect(within(dialog).getByText("Timer pill in the header")).toBeInTheDocument();
    // Nothing has changed yet.
    expect(flagRows.find((row) => row["key"] === "time-tracking")?.["enabled"]).toBe(true);

    await user.click(screen.getByTestId("confirm-flag-off"));
    await waitFor(() =>
      expect(flagRows.find((row) => row["key"] === "time-tracking")?.["enabled"]).toBe(false),
    );
  });

  it("can be talked out of it", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("flag-group-work");
    await user.click(screen.getByRole("switch", { name: "Turn off Time tracking" }));
    const dialog = await screen.findByRole("dialog", { name: "Turn off Time tracking?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(flagRows.find((row) => row["key"] === "time-tracking")?.["enabled"]).toBe(true);
  });

  it("previews what a role would have", async () => {
    renderPage("/admin/flags?as=VIEWER");
    expect(await screen.findByTestId("flag-preview-summary")).toHaveTextContent("As viewer: 2 of 4 features off");
    expect(await screen.findByTestId("preview-time-tracking")).toHaveTextContent("no");
    expect(screen.getByTestId("preview-dark-mode")).toHaveTextContent("yes");
    expect(screen.getByTestId("preview-csv-import")).toHaveTextContent("yes");
  });

  it("stops previewing", async () => {
    const user = userEvent.setup();
    renderPage("/admin/flags?as=VIEWER");
    await screen.findByTestId("flag-preview-summary");
    await user.click(screen.getByRole("button", { name: "Stop previewing" }));
    await waitFor(() => expect(screen.queryByTestId("flag-preview-summary")).not.toBeInTheDocument());
  });

  it("edits rollout and targeting in the drawer, and shows controls and history", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/platform/admin/groups", () =>
        HttpResponse.json({ items: [{ id: "g-ops", name: "Operations" }], total: 1 }),
      ),
      http.get("/platform/admin/organizations", () =>
        HttpResponse.json({ items: [{ id: "o-1", name: "Acme" }], total: 1 }),
      ),
    );
    renderPage();
    await screen.findByTestId("flag-group-work");
    await user.click(screen.getByTestId("configure-flag-time-tracking"));

    const drawer = await screen.findByTestId("flag-targeting");
    expect(screen.getByTestId("save-targeting")).toBeDisabled();
    await user.click(within(drawer).getByRole("combobox", { name: "Target groups" }));
    await user.click(await screen.findByTitle("Operations"));
    expect(screen.getByTestId("save-targeting")).toBeEnabled();
    await user.click(screen.getByTestId("save-targeting"));
    await waitFor(() =>
      expect(flagRows.find((row) => row["key"] === "time-tracking")?.["target_group_ids"]).toEqual(["g-ops"]),
    );

    await user.click(screen.getByRole("tab", { name: "What it controls" }));
    expect(await screen.findByTestId("flag-controls")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByText("disabled Time tracking")).toBeInTheDocument();
  });

  it("says when a flag has never been changed by hand", async () => {
    const user = userEvent.setup();
    renderPage("/admin/flags?flag=dark-mode");
    await screen.findByTestId("flag-targeting");
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByText("Never changed by hand")).toBeInTheDocument();
  });

  it("explains a missing flag in the drawer", async () => {
    renderPage("/admin/flags?flag=nope");
    expect(await screen.findByText("That flag does not exist.")).toBeInTheDocument();
  });

  it("reports a list that could not be read", async () => {
    server.use(http.get("/platform/admin/flags", () => HttpResponse.json({ error: "x", message: "Nope." }, { status: 500 })));
    renderPage();
    expect(await screen.findByText("Nope.")).toBeInTheDocument();
  });
});
