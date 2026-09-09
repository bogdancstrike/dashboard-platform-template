import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";

import ApiClientsPage, { credentialStory, stateTone } from "@/pages/admin/ApiClientsPage";
import type { Credential } from "@/api/apiClients";
import { CommandProvider } from "@/commands/CommandContext";
import { apiClientRows, currentUser, resetApiClients } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * Longer than the suite's twenty seconds, for a reason worth stating.
 *
 * The secret flow is *deliberately* three dialogs deep — a modal that cannot
 * be dismissed by clicking away, a confirmation on top of it, and a mutation
 * behind each — and two of the tests here drive the whole of it twice. Alone
 * they take ten seconds; under the full suite's parallelism, on a machine also
 * running the stack, they crossed twenty and failed as a timeout, which reads
 * as a broken dialog rather than as a slow test. Shortening the flow would
 * mean making the product less careful with a value that exists nowhere else.
 */
vi.setConfig({ testTimeout: 45_000 });

/**
 * API clients and their credentials (§25).
 *
 * The behaviour this file is built around: **a secret is shown once, so the
 * page must make losing it hard.** The modal cannot be dismissed by clicking
 * away, and confirming asks again — because the value exists nowhere else and
 * the recovery is minting another and redeploying whatever held the old one.
 *
 * `credentialStory` is asserted directly: a date on its own is not an answer.
 * "Expires 2026-09-15" asks the reader to know today's date and subtract; what
 * they want to know is whether there is time to redeploy.
 */
function render(route = "/admin/api") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/admin/api" element={<ApiClientsPage />} />
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
        permissions: [...currentUser.permissions, "api.manage", ...extra],
      }),
    ),
  );
}

afterEach(() => {
  resetApiClients();
});

const key = (overrides: Partial<Credential>): Credential => ({
  id: "k",
  label: "A key",
  prefix: "nuc_abc12345",
  state: "ACTIVE",
  created_at: "2026-08-01T09:00:00Z",
  expires_at: null,
  last_used_at: null,
  revoked_at: null,
  rotated_from_id: null,
  ...overrides,
});

describe("what a key's dates come to", () => {
  const today = new Date("2026-09-08T12:00:00Z");

  it("counts the days to an expiry rather than printing a date", () => {
    // "Expires 2026-09-15" asks the reader to know today and subtract. What
    // they want to know is whether there is time to redeploy.
    expect(
      credentialStory(key({ expires_at: "2026-09-15T12:00:00Z" }), today),
    ).toBe("Expires in 7 days");
  });

  it("says to act now when the deadline is today", () => {
    expect(
      credentialStory(key({ expires_at: "2026-09-08T20:00:00Z" }), today),
    ).toBe("Expires today — redeploy now");
  });

  it("leads with the revocation, because that is the whole story", () => {
    expect(
      credentialStory(
        key({ state: "REVOKED", revoked_at: "2026-09-01T09:00:00Z" }),
        today,
      ),
    ).toMatch(/^Revoked/);
  });

  it("says a key has never been used, rather than leaving a blank", () => {
    // A key nobody has ever called with is worth noticing: it is usually one
    // somebody minted and forgot to deploy.
    expect(credentialStory(key({}), today)).toBe("Never used");
    expect(credentialStory(key({ last_used_at: "2026-09-07T09:00:00Z" }), today)).toMatch(
      /^Last used/,
    );
  });

  it("gives expiry a warning tone and revocation none", () => {
    // Expiry is usually a rotation nobody finished — it needs attention.
    // Revocation is a decision somebody made, and colouring it red would put
    // every deliberate act on the same footing as a fault (§64).
    expect(stateTone("ACTIVE")).toBe("success");
    expect(stateTone("EXPIRED")).toBe("warning");
    expect(stateTone("REVOKED")).toBeUndefined();
  });
});

describe("the list", () => {
  it("says what each client may do and how it is keyed", async () => {
    withPermissions();
    render();

    const table = await screen.findByTestId("clients-table");
    await waitFor(() => expect(within(table).getByText("Warehouse sync")).toBeInTheDocument());
    expect(within(table).getByText("records.view, records.update")).toBeInTheDocument();
    expect(within(table).getByText("1 of 2")).toBeInTheDocument();
  });

  it("says a client with no live key cannot call, rather than '0 of 1'", async () => {
    withPermissions();
    render();

    const table = await screen.findByTestId("clients-table");
    await waitFor(() => expect(within(table).getByText("none live")).toBeInTheDocument());
  });

  it("labels the lifetime counter as a lifetime", async () => {
    withPermissions();
    render();

    const table = await screen.findByTestId("clients-table");
    // 3,778,870 lifetime beside two logged rows is two questions, not a
    // contradiction — so the number says which one it answers (§71). Asserted
    // on the cell's content rather than as an exact text node: the count and
    // the error rate share one element.
    await waitFor(() => expect(table).toHaveTextContent("3,778,870"));
    expect(table).toHaveTextContent("2.8% errors");
  });

  it("finds a client by its id", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("clients-table");
    await user.type(screen.getByLabelText("Search clients"), "importer01");

    await waitFor(() => expect(screen.queryByText("Warehouse sync")).not.toBeInTheDocument());
    expect(screen.getByText("Old importer")).toBeInTheDocument();
  });
});

describe("the secret, shown once", () => {
  it("goes into a modal that says it is the only time", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("clients-table");
    await user.click(screen.getByTestId("new-client"));
    // Warned before it exists, too.
    expect(await screen.findByText("Its key is shown once")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Client name"), "Fresh consumer");
    await user.click(screen.getByTestId("create-client"));

    const modal = await screen.findByTestId("secret-modal");
    expect(within(modal).getByTestId("secret-value")).toHaveTextContent(/^nuc_/);
    expect(within(modal).getByText(/keeps only a hash/)).toBeInTheDocument();
  });

  it("asks again before letting the modal close", async () => {
    // The value exists nowhere else, and the recovery is minting another and
    // redeploying whatever held the old one — so a stray click must not do it.
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("clients-table");
    await user.click(screen.getByTestId("new-client"));
    await user.type(await screen.findByLabelText("Client name"), "Careful close");
    await user.click(screen.getByTestId("create-client"));

    await screen.findByTestId("secret-modal");
    await user.click(screen.getByRole("button", { name: "I have copied it" }));

    // AntD's `modal.confirm` renders its title more than once (heading and
    // accessible name), so the count is what matters, not a single node.
    expect((await screen.findAllByText("Closing this is final")).length).toBeGreaterThan(0);
    // And there is a way back.
    expect(screen.getByRole("button", { name: "Wait, let me copy it" })).toBeInTheDocument();
  });

  it("mints a different secret every time", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("clients-table");
    await user.click(screen.getByTestId("new-client"));
    await user.type(await screen.findByLabelText("Client name"), "First");
    await user.click(screen.getByTestId("create-client"));
    const first = (await screen.findByTestId("secret-value")).textContent;

    await user.click(screen.getByRole("button", { name: "I have copied it" }));
    await user.click(await screen.findByRole("button", { name: "I have it" }));

    await user.click(screen.getByTestId("new-client"));
    await user.type(await screen.findByLabelText("Client name"), "Second");
    await user.click(screen.getByTestId("create-client"));
    const second = (await screen.findByTestId("secret-value")).textContent;

    expect(second).not.toBe(first);
  });
});

describe("the scopes a caller may grant", () => {
  it("offers only its own, and says how many it cannot", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("clients-table");
    await user.click(screen.getByTestId("new-client"));

    // A form offering the whole catalogue and refusing half of it on save
    // would be a form that produces an error on purpose.
    expect(
      await screen.findByText(/2 more exist that you cannot grant/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Scopes" }));
    expect(await screen.findByTitle(/records\.view — View records/)).toBeInTheDocument();
    expect(screen.queryByTitle(/roles\.manage/)).not.toBeInTheDocument();
  });
});

describe("one client", () => {
  it("shows its keys, its scopes and its recent requests", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("clients-table");
    await waitFor(() => expect(within(table).getByText("Warehouse sync")).toBeInTheDocument());
    await user.click(within(table).getByText("Warehouse sync"));

    expect(await screen.findByTestId("client-keys")).toBeInTheDocument();
    expect(screen.getByTestId("key-nuc_live0001")).toBeInTheDocument();
    // The revoked one is still listed: the question after a leak is when and
    // by whom (§34).
    expect(screen.getByTestId("key-nuc_old00001")).toBeInTheDocument();
    expect(within(screen.getByTestId("client-scopes")).getByText("records.view")).toBeInTheDocument();
    expect(within(screen.getByTestId("client-requests")).getByText(/records\/order/)).toBeInTheDocument();
  });

  it("labels the log window apart from the lifetime total", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("clients-table");
    await waitFor(() => expect(within(table).getByText("Warehouse sync")).toBeInTheDocument());
    await user.click(within(table).getByText("Warehouse sync"));

    const numbers = await screen.findByTestId("client-numbers");
    expect(within(numbers).getByText("Requests (lifetime)")).toBeInTheDocument();
    expect(within(numbers).getByText("In the log below")).toBeInTheDocument();
    expect(within(numbers).getByText("1 of 2 failed")).toBeInTheDocument();
  });

  it("warns when nothing can call at all", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("clients-table");
    await waitFor(() => expect(within(table).getByText("Old importer")).toBeInTheDocument());
    await user.click(within(table).getByText("Old importer"));

    expect(await screen.findByTestId("no-live-keys")).toHaveTextContent(
      "cannot call anything",
    );
  });

  it("offers no rotate or revoke on a key that is already dead", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("clients-table");
    await waitFor(() => expect(within(table).getByText("Warehouse sync")).toBeInTheDocument());
    await user.click(within(table).getByText("Warehouse sync"));

    await screen.findByTestId("key-nuc_live0001");
    expect(screen.getByTestId("rotate-nuc_live0001")).toBeInTheDocument();
    // Nothing to rotate or revoke on the revoked one.
    expect(screen.queryByTestId("rotate-nuc_old00001")).not.toBeInTheDocument();
    expect(screen.queryByTestId("revoke-nuc_old00001")).not.toBeInTheDocument();
  });
});

describe("rotation and revocation", () => {
  it("rotates, and says how long the old key keeps working", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("clients-table");
    await waitFor(() => expect(within(table).getByText("Warehouse sync")).toBeInTheDocument());
    await user.click(within(table).getByText("Warehouse sync"));

    await user.click(await screen.findByTestId("rotate-nuc_live0001"));
    // Said before it happens: the grace period is the whole point.
    expect(await screen.findByText(/keeps working for 7 days/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rotate" }));

    const modal = await screen.findByTestId("secret-modal");
    expect(within(modal).getByText(/previous key works for 7 more days/)).toBeInTheDocument();
  });

  it("warns that revoking has no grace period", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("clients-table");
    await waitFor(() => expect(within(table).getByText("Warehouse sync")).toBeInTheDocument());
    await user.click(within(table).getByText("Warehouse sync"));

    await user.click(await screen.findByTestId("revoke-nuc_live0001"));
    expect(
      await screen.findByText(/no grace period — that is what rotation is for/),
    ).toBeInTheDocument();
  });

  it("revokes, and says what stops working", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("clients-table");
    await waitFor(() => expect(within(table).getByText("Warehouse sync")).toBeInTheDocument());
    await user.click(within(table).getByText("Warehouse sync"));

    await user.click(await screen.findByTestId("revoke-nuc_live0001"));
    await user.click(screen.getByRole("button", { name: "Revoke it" }));

    expect(await screen.findByText(/Anything using it will fail now/)).toBeInTheDocument();
  });

  it("names what retiring a client costs before it happens", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("clients-table");
    await waitFor(() => expect(within(table).getByText("Warehouse sync")).toBeInTheDocument());
    await user.click(within(table).getByText("Warehouse sync"));

    await user.click(await screen.findByTestId("retire-client"));
    expect(await screen.findByText(/1 live key.*revoked with it/s)).toBeInTheDocument();
  });

  it("retires it, and says how many keys went with it", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("clients-table");
    await waitFor(() => expect(within(table).getByText("Warehouse sync")).toBeInTheDocument());
    await user.click(within(table).getByText("Warehouse sync"));

    await user.click(await screen.findByTestId("retire-client"));
    await user.click(await screen.findByRole("button", { name: "Retire it" }));

    await waitFor(() =>
      expect(apiClientRows.find((row) => row["id"] === "cli-warehouse")).toBeUndefined(),
    );
    expect(await screen.findByText(/1 live key revoked/)).toBeInTheDocument();
  });
});
