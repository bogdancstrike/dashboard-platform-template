import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import PreferencesPage from "@/pages/PreferencesPage";
import { CommandProvider } from "@/commands/CommandContext";
import { absoluteTime } from "@/lib/time";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

function renderPage() {
  return renderWithProviders(
    <CommandProvider>
      <PreferencesPage />
    </CommandProvider>,
    { route: "/settings/preferences" },
  );
}

describe("personal preferences", () => {
  it("shows what the server has stored, not what this browser remembers", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: /Preferences/ })).toBeInTheDocument();
    const formats = screen.getByTestId("pref-formats");
    // The profile says ISO dates and 24-hour time; the controls agree.
    // AntD marks the chosen option on the wrapper; the input carries the
    // attribute but not the DOM property, which `toBeChecked` reads.
    await waitFor(() =>
      expect(
        formats.querySelector(".ant-radio-button-wrapper-checked"),
      ).toHaveTextContent("2026-09-06"),
    );
    expect(
      formats.querySelector(".ant-segmented-item-selected [title='24-hour']"),
    ).not.toBeNull();
  });

  it("saves a change through the API rather than to local storage", async () => {
    const user = userEvent.setup();
    const writes: Record<string, unknown>[] = [];
    server.use(
      http.put("/platform/api/me", async ({ request }) => {
        const body = (await request.json()) as { preferences: Record<string, unknown> };
        writes.push(body.preferences);
        return HttpResponse.json({
          preferences: {
            appearance: { theme: "system", density: "middle", sidebar_collapsed: false },
            formats: { date: "DD/MM/YYYY", time: "24h", number: "1,234.56" },
            defaults: { page_size: 25, landing_page: "dashboard" },
          },
        });
      }),
    );

    renderPage();
    await user.click(await screen.findByText("06/09/2026"));

    await waitFor(() => expect(writes).toEqual([{ formats: { date: "DD/MM/YYYY" } }]));
  });

  it("changes how every timestamp in the app is drawn, not just this page", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText("09/06/2026"));

    // §40's whole point: the formatters the rest of the app calls are the ones
    // this page configures. `absoluteTime` is what an audit row uses.
    await waitFor(() => expect(absoluteTime("2026-09-06T15:42:08Z")).toMatch(/^9\/6\/2026/));

    // Put it back so the module store does not leak into the next test.
    await user.click(
      within(screen.getByTestId("pref-formats")).getByText("2026-09-06", {
        selector: ".ant-radio-button-wrapper span",
      }),
    );
    await waitFor(() => expect(absoluteTime("2026-09-06T15:42:08Z")).toMatch(/^2026-09-06/));
  });

  it("prints a worked example beside the controls", async () => {
    renderPage();

    const preview = await screen.findByTestId("format-preview");
    expect(within(preview).getByText("2026-09-06")).toBeInTheDocument();
    expect(within(preview).getByText("15:42")).toBeInTheDocument();
    expect(within(preview).getByText("1,234.56")).toBeInTheDocument();
  });

  it("sends only the section that changed, so the rest cannot be clobbered", async () => {
    const user = userEvent.setup();
    const writes: Record<string, unknown>[] = [];
    server.use(
      http.put("/platform/api/me", async ({ request }) => {
        const body = (await request.json()) as { preferences: Record<string, unknown> };
        writes.push(body.preferences);
        return HttpResponse.json({
          preferences: {
            appearance: { theme: "system", density: "middle", sidebar_collapsed: false },
            formats: { date: "YYYY-MM-DD", time: "24h", number: "1,234.56" },
            defaults: { page_size: 50, landing_page: "dashboard" },
          },
        });
      }),
    );

    renderPage();
    await user.click(await screen.findByRole("combobox", { name: "Rows per page" }));
    await user.click(await screen.findByTitle("50 rows"));

    await waitFor(() => expect(writes).toEqual([{ defaults: { page_size: 50 } }]));
  });

  it("says when a preference could not be saved, with the correlation id", async () => {
    const user = userEvent.setup();
    server.use(
      http.put("/platform/api/me", () =>
        HttpResponse.json(
          { error: "validation_error", message: "Unknown preference." },
          { status: 400, headers: { "X-Correlation-ID": "abc123" } },
        ),
      ),
    );

    renderPage();
    await user.click(await screen.findByText("06/09/2026"));

    expect(
      await screen.findByText("That preference could not be saved"),
    ).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  it("says whether it is saved or saving, because there is no Save button", async () => {
    renderPage();

    expect(await screen.findByTestId("save-state")).toHaveTextContent("Saved");
  });
});
