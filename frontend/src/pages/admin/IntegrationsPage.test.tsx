import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import IntegrationsPage, { situation, stateTone } from "@/pages/admin/IntegrationsPage";
import type { Integration } from "@/api/integrations";
import { CommandProvider } from "@/commands/CommandContext";
import { currentUser, integrationRows, resetIntegrations } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * Connected systems (§26).
 *
 * `situation` is where this page's whole argument lives, so it is asserted
 * directly: "switched on and working" and "switched on and failing" are two
 * different rows, and a single badge saying "error" would not tell a reader
 * whether anybody expects the thing to be running. That is the row somebody
 * has to act on, and losing it is the failure mode this screen exists to
 * avoid.
 *
 * The other claim worth pinning: a check must never say it reached the
 * provider, because in this template it never does.
 */
function render(route = "/admin/integrations") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/admin/integrations" element={<IntegrationsPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

function withPermissions(...extra: string[]) {
  server.use(
    http.get("/platform/api/me", () =>
      HttpResponse.json({
        ...currentUser,
        permissions: [...currentUser.permissions, "integrations.manage", ...extra],
      }),
    ),
  );
}

afterEach(() => {
  resetIntegrations();
});

const row = (overrides: Partial<Integration>): Integration =>
  ({
    id: "i",
    name: "Thing",
    provider: "Thing",
    category: "MESSAGING",
    enabled: false,
    state: "DISCONNECTED",
    configured: true,
    missing_settings: [],
    required_settings: ["base_url", "secret_ref"],
    ...overrides,
  }) as Integration;

describe("what an integration's two facts come to", () => {
  it("distinguishes switched-on-and-failing from merely failing", () => {
    // The distinction the page exists for. "Error" alone does not say whether
    // anybody expects it to be running.
    expect(situation(row({ enabled: true, state: "ERROR" }))).toBe("Switched on and failing");
    expect(situation(row({ enabled: false, state: "ERROR" }))).toBe(
      "Off, and it was failing when it stopped",
    );
  });

  it("says what is missing, and how far off it is", () => {
    expect(
      situation(row({ configured: false, missing_settings: ["secret_ref"] })),
    ).toBe("Needs secret_ref — one setting away from usable");
    expect(
      situation(row({ configured: false, missing_settings: ["base_url", "secret_ref"] })),
    ).toBe("Needs base_url and secret_ref — 2 settings away from usable");
  });

  it("distinguishes on-and-working from configured-but-off", () => {
    expect(situation(row({ enabled: true, state: "CONNECTED" }))).toBe("On, and working");
    expect(situation(row({ enabled: false, state: "DISCONNECTED" }))).toBe(
      "Configured, switched off",
    );
  });

  it("names the in-between state rather than guessing", () => {
    // Switched on, configured, and not connected yet: neither working nor
    // failing, and saying so beats picking one.
    expect(situation(row({ enabled: true, state: "DISCONNECTED" }))).toBe(
      "Switched on, not connected yet",
    );
  });

  it("keeps 'not configured' neutral rather than calling it a fault", () => {
    // Eight untouched providers in the same colour as the two that are broken
    // would make the colour useless (§64).
    expect(stateTone("CONNECTED")).toBe("success");
    expect(stateTone("ERROR")).toBe("error");
    expect(stateTone("NOT_CONFIGURED")).toBeUndefined();
  });
});

describe("the list", () => {
  it("counts what needs attention, and says it first", async () => {
    withPermissions();
    render();

    // The reason to open this page at all.
    expect(await screen.findByTestId("attention")).toHaveTextContent(
      "switched on and not connected",
    );
  });

  it("puts the rows that need somebody at the top", async () => {
    withPermissions();
    render();

    const table = await screen.findByTestId("integrations-table");
    await waitFor(() => expect(within(table).getByTestId("int-github")).toBeInTheDocument());

    const names = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((element) => element.textContent ?? "");
    // GitHub is on and failing, so it comes before Slack, which is working.
    expect(names[0]).toContain("GitHub");
  });

  it("says where each one stands, in words", async () => {
    withPermissions();
    render();

    const table = await screen.findByTestId("integrations-table");
    await waitFor(() =>
      expect(within(table).getByText("Switched on and failing")).toBeInTheDocument(),
    );
    expect(within(table).getByText("On, and working")).toBeInTheDocument();
    expect(within(table).getByText(/Needs secret_ref/)).toBeInTheDocument();
  });

  it("refuses the switch on something unconfigured, with the reason", async () => {
    withPermissions();
    render();

    await screen.findByTestId("integrations-table");
    // Disabled rather than hidden: turning it on *is* what somebody came to
    // do, and the settings are the actionable part (§76).
    expect(await screen.findByTestId("toggle-stripe")).toBeDisabled();
    expect(screen.getByTestId("toggle-slack")).toBeEnabled();
  });

  it("tallies the states from the derived value", async () => {
    withPermissions();
    render();

    // The chips have to agree with the rows underneath them (§71).
    const tally = await screen.findByTestId("state-tally");
    expect(tally).toHaveTextContent("1 connected");
    expect(tally).toHaveTextContent("1 error");
    expect(tally).toHaveTextContent("1 not configured");
  });

  it("narrows by category", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("integrations-table");
    // The label, not the radio: AntD's Segmented puts `pointer-events: none`
    // on the input and lets the label take the click, which is what a person
    // does anyway. The same helper `NotificationsPage.test` documents.
    await user.click(
      await screen.findByText(/payments/, { selector: ".ant-segmented-item-label" }),
    );

    await waitFor(() =>
      expect(screen.queryByTestId("int-slack")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("int-stripe")).toBeInTheDocument();
  });
});

describe("turning one on and off", () => {
  it("turns a configured one on", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("integrations-table");
    await user.click(await screen.findByTestId("toggle-okta"));

    await waitFor(() =>
      expect(integrationRows.find((item) => item["id"] === "int-okta")?.["enabled"]).toBe(true),
    );
  });

  it("stops one claiming to be connected once it is off", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("integrations-table");
    await user.click(await screen.findByTestId("toggle-slack"));

    await waitFor(() => {
      const slack = integrationRows.find((item) => item["id"] === "int-slack");
      expect(slack?.["enabled"]).toBe(false);
      // A stale CONNECTED on something switched off would be the screen saying
      // two contradictory things at once.
      expect(slack?.["state"]).not.toBe("CONNECTED");
    });
  });
});

describe("one integration", () => {
  it("shows a secret as set, never shown", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("integrations-table");
    await waitFor(() => expect(within(table).getByTestId("int-slack")).toBeInTheDocument());
    await user.click(within(table).getByTestId("int-slack"));

    const field = await screen.findByTestId("setting-secret_ref");
    // Empty with a placeholder asking for a replacement — the value is not
    // there to be read, and never was.
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", expect.stringContaining("type to replace"));
    // And the non-sensitive setting is shown, or the screen would be useless.
    expect(screen.getByTestId("setting-base_url")).toHaveValue("https://api.example");
  });

  it("marks the settings that are not set", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("integrations-table");
    await waitFor(() => expect(within(table).getByTestId("int-stripe")).toBeInTheDocument());
    await user.click(within(table).getByTestId("int-stripe"));

    const settings = await screen.findByTestId("int-settings");
    expect(within(settings).getByText(/not set/)).toBeInTheDocument();
  });

  it("shows the failure, and frames it by whether anybody expects it to run", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("integrations-table");
    await waitFor(() => expect(within(table).getByTestId("int-github")).toBeInTheDocument());
    await user.click(within(table).getByTestId("int-github"));

    // It is switched on, so the framing is "it is failing" rather than "it was
    // failing when it stopped".
    expect(await screen.findByTestId("int-error")).toHaveTextContent("It is failing");
    expect(screen.getByTestId("int-error")).toHaveTextContent("token expired");
  });

  it("does not offer Save until something has been typed", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("integrations-table");
    await waitFor(() => expect(within(table).getByTestId("int-slack")).toBeInTheDocument());
    await user.click(within(table).getByTestId("int-slack"));

    expect(await screen.findByTestId("save-settings")).toBeDisabled();
  });

  it("saves a setting and says whether anything is still missing", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("integrations-table");
    await waitFor(() => expect(within(table).getByTestId("int-stripe")).toBeInTheDocument());
    await user.click(within(table).getByTestId("int-stripe"));

    await user.type(await screen.findByTestId("setting-secret_ref"), "STRIPE_TOKEN");
    await user.click(screen.getByTestId("save-settings"));

    await waitFor(() =>
      expect(
        (integrationRows.find((item) => item["id"] === "int-stripe")?.["configuration"] as Record<
          string,
          unknown
        >)["secret_ref"],
      ).toBe("STRIPE_TOKEN"),
    );
    expect(await screen.findByText(/has everything it needs/)).toBeInTheDocument();
  });
});

describe("checking the settings", () => {
  it("says it did not contact the provider", async () => {
    // The claim that matters most on this page. A green tick reporting a
    // connection nothing attempted would be the worst lie available here.
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("integrations-table");
    await waitFor(() => expect(within(table).getByTestId("int-slack")).toBeInTheDocument());
    await user.click(within(table).getByTestId("int-slack"));

    await user.click(await screen.findByTestId("check-settings"));

    const result = await screen.findByTestId("check-result");
    expect(result).toHaveTextContent("Every required setting is present");
    expect(result).toHaveTextContent("does not contact Slack");
  });

  it("is called 'Check settings', not 'Test connection'", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("integrations-table");
    await waitFor(() => expect(within(table).getByTestId("int-slack")).toBeInTheDocument());
    await user.click(within(table).getByTestId("int-slack"));

    // The label is part of the honesty: a button called "Test connection" is a
    // claim before it is even pressed.
    expect(await screen.findByTestId("check-settings")).toHaveTextContent("Check settings");
    expect(screen.queryByText("Test connection")).not.toBeInTheDocument();
  });

  it("names what is missing when the check does not pass", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("integrations-table");
    await waitFor(() => expect(within(table).getByTestId("int-stripe")).toBeInTheDocument());
    await user.click(within(table).getByTestId("int-stripe"));

    await user.click(await screen.findByTestId("check-settings"));

    const result = await screen.findByTestId("check-result");
    expect(result).toHaveTextContent("Something is missing");
    expect(result).toHaveTextContent("secret_ref must be set");
  });
});
