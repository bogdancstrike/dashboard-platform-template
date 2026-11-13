import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import SettingsPage from "@/pages/admin/SettingsPage";
import { resetSettings, settingRows } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * Runtime configuration (§13): one control per kind of setting, written on
 * blur or Enter rather than per keystroke, a secret never shown, a JSON box
 * that refuses bad JSON in place, a reset, and the page failing to load.
 */
function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}

function render(route = "/admin/settings") {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/admin/settings" element={<SettingsPage />} />
      </Routes>
      <Where />
    </>,
    { route },
  );
}

afterEach(() => resetSettings());

const row = (key: string) => settingRows.find((item) => item["key"] === key)!;

/** A JSON setting, added to the fixture for one test (the fixture resets after each). */
function withJson() {
  settingRows.push({
    ...row("app.name"),
    key: "ui.home_widgets",
    label: "Home widgets",
    value_type: "json",
    value: { cards: 3 },
    default: { cards: 3 },
    changed: false,
  });
}

describe("each kind of setting", () => {
  it("writes a number on Enter, once, and not per digit", async () => {
    const user = userEvent.setup();
    render();
    const box = await screen.findByRole("spinbutton", { name: "Log retention value" });
    await user.clear(box);
    await user.type(box, "90{Enter}");
    await waitFor(() => expect(row("retention.log_days")["value"]).toBe(90));
    expect(await screen.findByText("Log retention saved")).toBeInTheDocument();
  });

  it("writes a number on blur, and ignores an unchanged one", async () => {
    render();
    const box = await screen.findByRole("spinbutton", { name: "Log retention value" });
    fireEvent.blur(box, { target: { value: "60" } });
    fireEvent.change(box, { target: { value: "45" } });
    fireEvent.blur(box);
    await waitFor(() => expect(row("retention.log_days")["value"]).toBe(45));
  });

  it("never shows a secret, and replaces it when something is typed", async () => {
    render();
    const secret = await screen.findByLabelText("Webhook signing key value");
    expect(secret).toHaveValue("");
    expect(secret).toHaveAttribute("placeholder", "A value is set — type to replace it");
    fireEvent.blur(secret);
    fireEvent.change(secret, { target: { value: "s3cret-ünï" } });
    fireEvent.blur(secret);
    await waitFor(() => expect(row("integrations.webhook_signing_key")["value"]).toBe("s3cret-ünï"));
  });

  it("writes text on blur only when it changed", async () => {
    render();
    const name = await screen.findByLabelText("Application name value");
    fireEvent.blur(name);
    fireEvent.change(name, { target: { value: "Nucleus ✓" } });
    fireEvent.blur(name);
    await waitFor(() => expect(row("app.name")["value"]).toBe("Nucleus ✓"));
  });

  it("refuses bad JSON in place and saves good JSON", async () => {
    withJson();
    const puts: unknown[] = [];
    server.use(
      http.put("/platform/admin/settings/:key", async ({ request }) => {
        puts.push(await request.json());
        return HttpResponse.json({ ...row("app.name"), key: "ui.home_widgets", label: "Home widgets" });
      }),
    );
    render();
    const box = await screen.findByLabelText("Home widgets value");
    fireEvent.change(box, { target: { value: "{ nope" } });
    fireEvent.blur(box);
    fireEvent.change(box, { target: { value: '{"cards": 5}' } });
    fireEvent.blur(box);
    await waitFor(() => expect(puts).toEqual([{ value: { cards: 5 } }]));
  });

  it("resets a changed setting to its default", async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Reset Log retention" }));
    expect(await screen.findByText("Log retention is back at its default")).toBeInTheDocument();
    expect(row("retention.log_days")["value"]).toBe(30);
  });
});

describe("refusals and failures", () => {
  it("says a refused change and a refused reset in the server's words", async () => {
    const user = userEvent.setup();
    server.use(
      http.put("/platform/admin/settings/:key", () =>
        HttpResponse.json({ error: "validation_failed", message: "Retention cannot exceed 3650 days." }, { status: 400 }),
      ),
    );
    render();
    const box = await screen.findByRole("spinbutton", { name: "Log retention value" });
    fireEvent.change(box, { target: { value: "9999" } });
    fireEvent.blur(box);
    expect(await screen.findByText("Retention cannot exceed 3650 days.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset Log retention" }));
    expect((await screen.findAllByText("Retention cannot exceed 3650 days.")).length).toBeGreaterThan(0);
  });

  it("says the settings could not be loaded", async () => {
    server.use(
      http.get("/platform/admin/settings", () => HttpResponse.json({ error: "forbidden", message: "Settings are for administrators." }, { status: 403 })),
    );
    render();
    expect(await screen.findByText("Settings are for administrators.")).toBeInTheDocument();
  });

  it("keeps a search in the address", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByRole("searchbox", { name: "Search settings" }), "retention");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("q=retention"));
  });
});
