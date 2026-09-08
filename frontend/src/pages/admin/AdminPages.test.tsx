import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import AdminHomePage, { destinations } from "@/pages/admin/AdminHomePage";
import SettingsPage, { controlFor } from "@/pages/admin/SettingsPage";
import FlagsPage, { reachOf } from "@/pages/admin/FlagsPage";
import type { FeatureFlag } from "@/api/settings";
import { CommandProvider } from "@/commands/CommandContext";
import { currentUser, flagRows, resetFlags, resetSettings, settingRows } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * The administration area (§11, §27).
 *
 * Three rules carry these pages, and each is a pure function so it can be
 * stated exactly: which card a reader is shown, which control a setting's
 * declaration asks for, and what a flag's rollout adds up to in words. The
 * rest is asserted through the pages, because that is where the writes are.
 */
function render(element: React.ReactNode, route: string) {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path={route.split("?")[0]} element={element} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

/** The administrator the fixtures ship, plus whatever a test needs. */
function withPermissions(...extra: string[]) {
  server.use(
    http.get("/platform/api/me", () =>
      HttpResponse.json({
        ...currentUser,
        permissions: [...currentUser.permissions, ...extra],
      }),
    ),
  );
}

afterEach(() => {
  resetSettings();
  resetFlags();
});

describe("which admin cards a reader is shown", () => {
  it("names, for every card, the permission its destination checks for", () => {
    // A card whose permission drifted from its route's would be a card that
    // opens onto a refusal.
    for (const card of destinations({})) {
      expect(card.permission).toMatch(/^[a-z]+\.[a-z]+$/);
      expect(card.to.startsWith("/admin/")).toBe(true);
    }
  });

  it("carries a live number only where one is cheap and worth knowing", () => {
    const withCounts = destinations({ people: 25, settingsChanged: 5, flagsOn: 9 });
    expect(withCounts.find((card) => card.to === "/admin/users")?.badge).toBe("25 people");
    expect(withCounts.find((card) => card.to === "/admin/flags")?.badge).toBe("9 on");
    // And nothing where there is no number: a badge reading "0" would be a
    // number nobody acts on.
    expect(destinations({}).find((card) => card.to === "/admin/users")?.badge).toBeUndefined();
  });
});

describe("the admin index", () => {
  it("lists only what the reader may open", async () => {
    render(<AdminHomePage />, "/admin");

    const map = await screen.findByTestId("admin-map");
    // The fixture's reader holds `admin.access`, `records.view`, `users.view`
    // and `health.view` — so People and Health are there, and Settings is not.
    expect(within(map).getByText("People")).toBeInTheDocument();
    expect(within(map).getByText("System health")).toBeInTheDocument();
    // Absent, not greyed out: a card that refuses to open is a worse answer
    // than no card (§76).
    expect(within(map).queryByText("System settings")).not.toBeInTheDocument();
    expect(within(map).queryByText("Feature flags")).not.toBeInTheDocument();
  });

  it("shows a card as soon as the reader holds its permission", async () => {
    withPermissions("settings.manage", "flags.manage");
    render(<AdminHomePage />, "/admin");

    const map = await screen.findByTestId("admin-map");
    expect(within(map).getByText("System settings")).toBeInTheDocument();
    expect(within(map).getByText("Feature flags")).toBeInTheDocument();
  });
});

describe("which control a setting asks for", () => {
  it("maps each declared type to the control that can hold it", () => {
    // The claim the whole settings page rests on. A boolean rendered as a text
    // box stores the string "false", which reads as *true* everywhere.
    expect(controlFor({ value_type: "boolean", is_secret: false })).toBe("switch");
    expect(controlFor({ value_type: "choice", is_secret: false })).toBe("select");
    expect(controlFor({ value_type: "integer", is_secret: false })).toBe("number");
    expect(controlFor({ value_type: "duration", is_secret: false })).toBe("number");
    expect(controlFor({ value_type: "json", is_secret: false })).toBe("textarea");
    expect(controlFor({ value_type: "string", is_secret: false })).toBe("text");
  });

  it("gives a secret its own control whatever its type says", () => {
    // A text box pre-filled with a signing key puts it in a screenshot.
    expect(controlFor({ value_type: "string", is_secret: true })).toBe("secret");
  });
});

describe("the settings page", () => {
  it("groups the settings and renders each control from its declaration", async () => {
    withPermissions("settings.manage");
    render(<SettingsPage />, "/admin/settings");

    await screen.findByTestId("settings-appearance");
    // A choice gets a select, a boolean a switch, a bounded number a spinner.
    expect(screen.getByRole("combobox", { name: "Default table density value" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Require MFA value" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Log retention value" })).toBeInTheDocument();
  });

  it("says once, at the top, how many settings need a restart", async () => {
    withPermissions("settings.manage");
    render(<SettingsPage />, "/admin/settings");

    // Said once rather than on every row: a page of eleven identical warnings
    // is a page nobody reads.
    expect(await screen.findByTestId("restart-pending")).toHaveTextContent(
      "1 setting needs a restart",
    );
  });

  it("writes a boolean as a boolean, immediately", async () => {
    withPermissions("settings.manage");
    const user = userEvent.setup();
    render(<SettingsPage />, "/admin/settings");

    await screen.findByTestId("settings-security");
    await user.click(screen.getByRole("switch", { name: "Require MFA value" }));

    await waitFor(() =>
      expect(settingRows.find((row) => row["key"] === "security.mfa_required")?.["value"]).toBe(
        true,
      ),
    );
  });

  it("offers Reset only where there is something to undo", async () => {
    withPermissions("settings.manage");
    render(<SettingsPage />, "/admin/settings");

    await screen.findByTestId("settings-retention");
    // The changed one has it; the ones at their default do not — a row of
    // permanently disabled Reset buttons is noise.
    expect(screen.getByTestId("reset-retention.log_days")).toBeInTheDocument();
    expect(screen.queryByTestId("reset-app.name")).not.toBeInTheDocument();
  });

  it("resets a setting to what the platform ships with", async () => {
    withPermissions("settings.manage");
    const user = userEvent.setup();
    render(<SettingsPage />, "/admin/settings");

    await screen.findByTestId("settings-retention");
    await user.click(screen.getByTestId("reset-retention.log_days"));

    await waitFor(() =>
      expect(settingRows.find((row) => row["key"] === "retention.log_days")?.["value"]).toBe(30),
    );
  });

  it("never pre-fills a secret", async () => {
    withPermissions("settings.manage");
    render(<SettingsPage />, "/admin/settings");

    await screen.findByTestId("setting-integrations.webhook_signing_key");
    const field = screen.getByLabelText("Webhook signing key value");
    // The server sends the redaction; the field asks for a replacement rather
    // than showing what is there.
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", expect.stringContaining("type to replace"));
  });
});

describe("what a flag's rollout adds up to", () => {
  const flag = (overrides: Partial<FeatureFlag>): FeatureFlag =>
    ({
      enabled: true,
      rollout_percentage: 0,
      target_roles: [],
      target_user_ids: [],
      ...overrides,
    }) as FeatureFlag;

  it("says off is off, whatever the rollout claims", () => {
    expect(reachOf(flag({ enabled: false, rollout_percentage: 100 }))).toBe(
      "Off for everybody",
    );
  });

  it("distinguishes everybody from a share, and says the share is stable", () => {
    expect(reachOf(flag({ rollout_percentage: 100 }))).toBe("Everybody");
    // "50%" on its own leaves a reader guessing whether it flickers.
    expect(reachOf(flag({ rollout_percentage: 50 }))).toBe(
      "50% of people, always the same ones",
    );
  });

  it("says so when a flag is on and reaches nobody", () => {
    // Enabled at nought per cent with nobody named is the state that looks
    // like a bug and is a configuration.
    expect(reachOf(flag({ rollout_percentage: 0 }))).toBe(
      "Nobody — no rollout and nobody named",
    );
  });

  it("names the targets, and adds them to a share", () => {
    expect(reachOf(flag({ rollout_percentage: 0, target_roles: ["MANAGER"] }))).toBe(
      "Only MANAGER",
    );
    expect(reachOf(flag({ rollout_percentage: 25, target_roles: ["MANAGER"] }))).toBe(
      "25% of people, always the same ones, plus MANAGER",
    );
    expect(
      reachOf(flag({ rollout_percentage: 100, target_user_ids: ["a", "b"] })),
    ).toBe("Everybody (and 2 named people)");
  });
});

describe("the flags page", () => {
  it("answers, per row, whether the reader has it", async () => {
    withPermissions("flags.manage");
    render(<FlagsPage />, "/admin/flags");

    const table = await screen.findByTestId("flags-table");
    // The fixture's partial flag is on and *not* on for this reader — the row
    // the page exists to explain.
    expect(within(table).getByText("10% of people, always the same ones")).toBeInTheDocument();
    expect(within(table).getAllByText("yes").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("no").length).toBeGreaterThan(0);
  });

  it("turns a flag off from the row", async () => {
    withPermissions("flags.manage");
    const user = userEvent.setup();
    render(<FlagsPage />, "/admin/flags");

    await screen.findByTestId("flags-table");
    await user.click(screen.getByRole("switch", { name: "Turn off Dark mode" }));

    await waitFor(() =>
      expect(flagRows.find((row) => row["key"] === "dark-mode")?.["enabled"]).toBe(false),
    );
  });

  it("refuses to delete a live flag, and says why before it is tried", async () => {
    withPermissions("flags.manage");
    render(<FlagsPage />, "/admin/flags");

    await screen.findByTestId("flags-table");
    // Disabled with the reason rather than absent: deleting a flag *is*
    // something an administrator does, once it is off (§76).
    expect(screen.getByTestId("delete-flag-dark-mode")).toBeDisabled();
    expect(screen.getByTestId("delete-flag-ai-summaries")).toBeEnabled();
  });

  it("creates a flag off, and says so before it is created", async () => {
    withPermissions("flags.manage");
    const user = userEvent.setup();
    render(<FlagsPage />, "/admin/flags");

    await screen.findByTestId("flags-table");
    await user.click(screen.getByTestId("new-flag"));

    const form = await screen.findByTestId("flag-form");
    // Said on the way in: a flag that arrived on would ship whatever it
    // guards at the moment it was made.
    expect(screen.getByText("It arrives off, and reaching nobody")).toBeInTheDocument();

    await user.type(within(form).getByLabelText("Flag name"), "Saved thumbnails");
    await user.type(within(form).getByLabelText("Flag key"), "saved-thumbnails");
    await user.click(screen.getByTestId("create-flag"));

    await waitFor(() =>
      expect(flagRows.find((row) => row["key"] === "saved-thumbnails")?.["enabled"]).toBe(false),
    );
  });
});
