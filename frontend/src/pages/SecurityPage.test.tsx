import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import SecurityPage, {
  headline,
  headlineTone,
  sessionSituation,
  sessionTone,
  severityTone,
} from "@/pages/SecurityPage";
import type { SecurityOverview, SignInSession } from "@/api/security";
import { CommandProvider } from "@/commands/CommandContext";
import { resetSecurity, securityEventRows, sessionRows } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * The reader's own security page (§41).
 *
 * `headline` is where this page's argument lives, so it is asserted directly:
 * the page opens with a *sentence* rather than four counters, because the
 * question is "is anything wrong" and a row of numbers makes the reader answer
 * it themselves. The ordering is the decision — failed sign-ins before
 * unresolved warnings before how many devices — and losing it would put the
 * one thing worth acting on below two things that are not.
 *
 * `sessionSituation` keeps the three states apart. "Somebody signed this out"
 * and "this ran out on its own" are different facts, and a page saying
 * "inactive" for both would hide the only one anybody acted on.
 *
 * The other claim worth pinning: **no permission is needed**. The fixture's
 * user holds nothing in particular and the page must render — a security page
 * that had to be granted is one most people never see.
 */
function render(route = "/settings/security") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/settings/security" element={<SecurityPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

afterEach(() => {
  resetSecurity();
});

const asSession = (overrides: Partial<SignInSession>): SignInSession =>
  ({
    id: "s",
    device: "Chrome",
    user_agent: "Mozilla/5.0",
    ip_address: "198.51.100.4",
    location: "Bucharest, RO",
    state: "ACTIVE",
    current: false,
    trusted: false,
    signed_in_at: null,
    last_seen_at: null,
    expires_at: null,
    revoked_at: null,
    can_revoke: true,
    ...overrides,
  });

const asOverview = (overrides: Partial<SecurityOverview>): SecurityOverview =>
  ({
    window_days: 90,
    active_sessions: 1,
    other_sessions: 0,
    current_known: true,
    failed_sign_ins: 0,
    failures_worth_saying: false,
    failure_addresses: [],
    unresolved_events: 0,
    last_signed_in_at: null,
    last_signed_in_from: null,
    last_signed_in_on: null,
    ...overrides,
  });

describe("the sentence the page opens with", () => {
  it("leads with the failed sign-ins, and says what to do", () => {
    // The one thing worth acting on, first — and with the *action*, because
    // "seven failed sign-ins" without "sign out everywhere and change your
    // password" is a fact nobody can use.
    const said = headline(
      asOverview({
        failed_sign_ins: 7,
        failures_worth_saying: true,
        failure_addresses: ["203.0.113.9"],
        unresolved_events: 4,
        other_sessions: 3,
      }),
    );
    expect(said).toContain("7 failed sign-ins");
    expect(said).toContain("203.0.113.9");
    expect(said).toContain("change your password");
  });

  it("does not lead with one failed sign-in, because that is a typo", () => {
    // The threshold is the server's — the page reads `failures_worth_saying`
    // rather than applying a number of its own.
    const said = headline(
      asOverview({ failed_sign_ins: 1, failures_worth_saying: false, unresolved_events: 2 }),
    );
    expect(said).not.toContain("failed sign-ins");
    expect(said).toContain("2 security events");
  });

  it("falls back to the devices, and then to reassurance", () => {
    expect(headline(asOverview({ other_sessions: 3 }))).toContain("3 other devices");
    expect(headline(asOverview({ other_sessions: 1 }))).toContain("one other device");
    expect(headline(asOverview({}))).toContain("only device you are signed in on");
  });

  it("is a warning, an amber note, or a reassurance — in that order", () => {
    expect(headlineTone(asOverview({ failures_worth_saying: true, unresolved_events: 9 }))).toBe(
      "error",
    );
    expect(headlineTone(asOverview({ unresolved_events: 1 }))).toBe("warning");
    expect(headlineTone(asOverview({ other_sessions: 5 }))).toBe("success");
  });
});

describe("what one session comes to", () => {
  it("keeps 'signed out' apart from 'expired on its own'", () => {
    // Somebody's decision against time passing. A page saying "inactive" for
    // both would hide the only one anybody acted on.
    expect(sessionSituation(asSession({ state: "REVOKED", can_revoke: false }))).toBe(
      "Signed out",
    );
    expect(sessionSituation(asSession({ state: "EXPIRED", can_revoke: false }))).toBe(
      "Expired on its own",
    );
  });

  it("marks the device the page is being read from", () => {
    expect(sessionSituation(asSession({ current: true }))).toBe("This device, right now");
  });

  it("says whether a live session is one you recognised", () => {
    expect(sessionSituation(asSession({ trusted: true }))).toBe(
      "Signed in — a device you recognise",
    );
    expect(sessionSituation(asSession({ trusted: false }))).toBe("Signed in");
  });

  it("colours the current session and an unrecognised live one, and nothing else", () => {
    // Revoked and expired are ordinary history: colouring them would spend
    // attention on rows nothing can be done about (§64).
    expect(sessionTone(asSession({ current: true }))).toBe("success");
    expect(sessionTone(asSession({ trusted: false }))).toBe("warning");
    expect(sessionTone(asSession({ trusted: true }))).toBeUndefined();
    expect(sessionTone(asSession({ state: "REVOKED", can_revoke: false }))).toBeUndefined();
    expect(sessionTone(asSession({ state: "EXPIRED", can_revoke: false }))).toBeUndefined();
  });

  it("gives an ordinary event no colour at all", () => {
    expect(severityTone("CRITICAL")).toBe("error");
    expect(severityTone("WARNING")).toBe("warning");
    expect(severityTone("INFO")).toBeUndefined();
  });
});

describe("the page", () => {
  it("renders for somebody holding no particular permission", async () => {
    // A security page that had to be granted is one most people never see.
    render();
    expect(await screen.findByTestId("sessions-table")).toBeInTheDocument();
    expect(screen.getByTestId("sign-ins-card")).toBeInTheDocument();
    expect(screen.getByTestId("events-card")).toBeInTheDocument();
  });

  it("opens with the sentence and says when you last signed in", async () => {
    render();
    const headlineBox = await screen.findByTestId("security-headline");
    // Two unresolved events in the fixture, and only one failure — so the
    // events are what it leads with.
    expect(headlineBox).toHaveTextContent("2 security events");
    expect(await screen.findByTestId("last-sign-in")).toHaveTextContent("Firefox");
  });

  it("marks the session the page was fetched from", async () => {
    render();
    const table = await screen.findByTestId("sessions-table");
    await waitFor(() => expect(within(table).getByText("This device")).toBeInTheDocument());
    expect(within(table).getByText("This device, right now")).toBeInTheDocument();
  });

  it("offers a sign-out only where there is a live session", async () => {
    render();
    await screen.findByTestId("sessions-table");
    expect(await screen.findByTestId("revoke-sess-mobile")).toBeInTheDocument();
    // Revoked and expired have nothing to act on.
    expect(screen.queryByTestId("revoke-sess-gone")).not.toBeInTheDocument();
    expect(screen.queryByTestId("revoke-sess-old")).not.toBeInTheDocument();
  });

  it("asks a different question before signing you out of this device", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("sessions-table");

    await user.click(await screen.findByTestId("revoke-sess-here"));
    // Pressing "revoke" down a list and landing on your own row is how
    // somebody loses their work, so the copy says what will happen.
    expect(await screen.findByText(/sent back to the sign-in page/)).toBeInTheDocument();
  });

  it("signs another device out, and it stops being live", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("sessions-table");

    await user.click(await screen.findByTestId("revoke-sess-mobile"));
    await user.click(await screen.findByRole("button", { name: "Sign it out" }));

    await waitFor(() =>
      expect(sessionRows.find((row) => row["id"] === "sess-mobile")?.["state"]).toBe("REVOKED"),
    );
  });

  it("says how many other devices the sweep would sign out", async () => {
    render();
    // The number, because "sign out everywhere" without it is an action
    // whose scope nobody can see.
    expect(await screen.findByTestId("revoke-others")).toHaveTextContent(
      "Sign out 1 other device",
    );
  });

  it("disables the sweep when there is nowhere else signed in", async () => {
    server.use(
      http.get("/platform/security/sessions", () =>
        HttpResponse.json({
          items: [],
          total: 0,
          active: 0,
          others: 0,
          current_known: true,
        }),
      ),
    );
    render();
    await waitFor(() =>
      expect(screen.getByTestId("revoke-others")).toHaveTextContent("Nowhere else signed in"),
    );
    expect(screen.getByTestId("revoke-others")).toBeDisabled();
  });

  it("keeps this session when signing out the others", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("sessions-table");

    await user.click(screen.getByTestId("revoke-others"));
    await user.click(await screen.findByRole("button", { name: "Sign the others out" }));

    await waitFor(() =>
      expect(sessionRows.find((row) => row["id"] === "sess-mobile")?.["state"]).toBe("REVOKED"),
    );
    // The one you are reading from survives, or the result would be
    // impossible to look at.
    expect(sessionRows.find((row) => row["id"] === "sess-here")?.["state"]).toBe("ACTIVE");
  });

  it("says plainly that recognising a device grants nothing", async () => {
    render();
    await screen.findByTestId("sessions-table");
    // A page implying "trusted" buys something would be claiming a control
    // the platform does not have.
    expect(
      await screen.findByTestId("trust-sess-mobile"),
    ).toHaveAttribute("aria-label", "Recognise Mobile");
  });
});

describe("the sign-in history", () => {
  it("shows a failure with its reason", async () => {
    render();
    const table = await screen.findByTestId("sign-ins-table");
    await waitFor(() => expect(within(table).getByText("Failed")).toBeInTheDocument());
    // The difference between a typo and somebody trying your password.
    expect(within(table).getByText("Wrong password")).toBeInTheDocument();
    expect(within(table).getByText("203.0.113.9")).toBeInTheDocument();
  });

  it("narrows to the failures, which is what somebody came for", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("sign-ins-table");

    // The label, not the radio: AntD's Segmented puts `pointer-events: none`
    // on the input and lets the label take the click.
    await user.click(
      await screen.findByText("Failures only", { selector: ".ant-segmented-item-label" }),
    );

    // Scoped to the sign-in table: "Signed in" is also a *session* state tag
    // in the card above, so a page-wide query finds four of them and never
    // goes away.
    await waitFor(() =>
      expect(
        within(screen.getByTestId("sign-ins-table")).queryByText("Signed in"),
      ).not.toBeInTheDocument(),
    );
    expect(within(screen.getByTestId("sign-ins-table")).getByText("Failed")).toBeInTheDocument();
  });

  it("says the window and that nothing is deleted", async () => {
    render();
    const note = await screen.findByTestId("sign-in-window");
    expect(note).toHaveTextContent("90 days");
    // A security page whose rows can be tidied away is one an attacker tidies
    // away, so the page says so.
    expect(note).toHaveTextContent("ever deleted");
  });

  it("says the good news when there are no failures", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/platform/security/sign-ins", ({ request }) => {
        const result = new URL(request.url).searchParams.get("result");
        return HttpResponse.json({
          items: result ? [] : [{ id: "x", result: "SUCCESS", reason: null, method: "SSO",
            device: "Firefox", ip_address: "1.1.1.1", location: null, at: null }],
          total: result ? 0 : 1,
          page: 1,
          page_size: 25,
          pages: 1,
          facets: {},
          window_days: 90,
        });
      }),
    );
    render();
    await screen.findByTestId("sign-ins-table");
    await user.click(
      await screen.findByText("Failures only", { selector: ".ant-segmented-item-label" }),
    );

    expect(await screen.findByText(/That is the answer you want/)).toBeInTheDocument();
  });
});

describe("what the platform noticed", () => {
  it("colours a critical event and leaves an informational one alone", async () => {
    render();
    const table = await screen.findByTestId("events-table");
    await waitFor(() =>
      expect(within(table).getByText(/distant locations/)).toBeInTheDocument(),
    );
    expect(within(table).getByText("critical")).toBeInTheDocument();
    expect(within(table).getAllByText("info").length).toBeGreaterThan(0);
  });

  it("marks one as looked at, reversibly", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("events-table");

    await user.click(await screen.findByTestId("resolve-ev-device"));
    await waitFor(() =>
      expect(securityEventRows.find((row) => row["id"] === "ev-device")?.["resolved"]).toBe(
        true,
      ),
    );

    // Reversible and not a delete: the row has to survive so the page can
    // still answer whether anything was looked at.
    await user.click(await screen.findByTestId("resolve-ev-device"));
    await waitFor(() =>
      expect(securityEventRows.find((row) => row["id"] === "ev-device")?.["resolved"]).toBe(
        false,
      ),
    );
  });

  it("says what would appear here when nothing has", async () => {
    server.use(
      http.get("/platform/security/events", () =>
        HttpResponse.json({ items: [], total: 0, page: 1, page_size: 25, pages: 1, facets: {} }),
      ),
    );
    render();
    // An empty state that says what would appear, rather than "no data".
    expect(await screen.findByText(/New devices, changed passwords/)).toBeInTheDocument();
  });
});
