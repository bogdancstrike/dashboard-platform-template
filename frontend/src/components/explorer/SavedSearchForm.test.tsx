import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedSearch } from "@/api/explorer";
import { SavedSearchForm } from "@/components/explorer/SavedSearchForm";
import { currentUser, people, savedViews } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * Saving a question (§5, §46): its name, who can see it, and — for the owner —
 * handing it to somebody else.
 */
const QUESTION = {
  resource_type: "task",
  condition_tree: null,
  filters: { status: "OPEN" },
  query_text: "",
  sort: "due_date",
  order: "asc" as const,
  columns: ["reference", "title"],
  page_size: 25,
  view_mode: "table" as const,
};

const OTTO = people[1]!;

/** Types a name into a people picker and takes the person the server found. */
async function pick(label: string, name: string, email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole("combobox", { name: label }), name);
  // Wait for the server's answer to the term, not the list from before it:
  // clicking an option the next render replaces selects nothing.
  const option = await waitFor(() => {
    const offered = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")];
    if (offered.length !== 1 || offered[0]!.getAttribute("title") !== email) throw new Error(`${name} was not offered alone`);
    return offered[0]!;
  });
  await user.click(option);
}

const sharing = (on: boolean) =>
  server.use(
    http.get("/platform/api/me", () =>
      HttpResponse.json({
        ...currentUser,
        permissions: on ? [...currentUser.permissions, "searches.share"] : currentUser.permissions,
      }),
    ),
  );

const SHARED = {
  ...savedViews[0]!,
  scope: "SHARED",
  members: [{ id: OTTO.id, name: OTTO.name, email: OTTO.email }],
} as unknown as SavedSearch;

function open(props: Partial<Parameters<typeof SavedSearchForm>[0]> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const onTransferred = vi.fn();
  renderWithProviders(
    <SavedSearchForm open value={QUESTION} onClose={onClose} onSaved={onSaved} onTransferred={onTransferred} {...props} />,
  );
  return { onSaved, onClose, onTransferred };
}

const bodies: Record<string, unknown>[] = [];
beforeEach(() => {
  bodies.length = 0;
  server.use(
    http.post("/platform/api/saved-searches", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return HttpResponse.json({ ...savedViews[0], ...body, id: "ss-new" }, { status: 201 });
    }),
    http.post("/platform/api/saved-searches/:id/transfer", async ({ request }) => {
      const body = (await request.json()) as { owner_id: string };
      bodies.push(body);
      return HttpResponse.json({ ...SHARED, owner: { id: OTTO.id, name: OTTO.name, email: OTTO.email }, can_edit: false });
    }),
  );
});

describe("a reader who may only keep private searches", () => {
  it("saves privately, says why sharing is closed, and wants a name", async () => {
    const user = userEvent.setup();
    sharing(false);
    const { onSaved, onClose } = open();
    expect(await screen.findByText("Your role can keep private searches, not publish them")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save search" }));
    expect(await screen.findByText("Give it a name")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "Ünïcode — due this week ✓");
    await user.click(screen.getByRole("button", { name: "Save search" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(bodies[0]).toMatchObject({ name: "Ünïcode — due this week ✓", scope: "PRIVATE", filters: { status: "OPEN" } });
    // No audience is sent by somebody who may not set one.
    expect(bodies[0]).not.toHaveProperty("member_ids");
  });

  it("reports a refused save in the server's words", async () => {
    const user = userEvent.setup();
    sharing(false);
    server.use(
      http.post("/platform/api/saved-searches", () =>
        HttpResponse.json({ error: "conflict", message: "You already have a search with that name." }, { status: 409 }),
      ),
    );
    open();
    await user.type(screen.getByLabelText("Name"), "Dup");
    await user.click(screen.getByRole("button", { name: "Save search" }));
    expect(await screen.findByText("You already have a search with that name.")).toBeInTheDocument();
  });
});

describe("a reader who may share", () => {
  beforeEach(() => sharing(true));

  it("shares with named people, and keeps them while public", async () => {
    const user = userEvent.setup();
    const { onSaved } = open();
    await user.type(screen.getByLabelText("Name"), "Team view");
    await user.click(await screen.findByText("Shared"));
    expect(screen.getByText("You, plus the people you name below.")).toBeInTheDocument();
    await pick("Share with", "Otto", OTTO.email);
    await user.click(screen.getByText("Public"));
    expect(screen.getByText(/These names are kept for when you switch back/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save search" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodies[0]).toMatchObject({ name: "Team view", member_ids: [OTTO.id] });
  });

  it("edits a shared search with its members already named, and hands it over", async () => {
    const user = userEvent.setup();
    const { onTransferred } = open({ search: SHARED });
    expect(await screen.findByText(`Edit “${SHARED.name}”`)).toBeInTheDocument();
    expect(screen.getByDisplayValue(SHARED.name)).toBeInTheDocument();
    expect(await screen.findByText("Otto Operator")).toBeInTheDocument();

    const transfer = screen.getByRole("button", { name: "Transfer ownership" });
    expect(transfer).toBeDisabled();
    await pick("Transfer ownership to", "Otto", OTTO.email);
    await waitFor(() => expect(transfer).toBeEnabled());
    await user.click(transfer);
    const confirm = await screen.findByRole("tooltip");
    await user.click(within(confirm).getByRole("button", { name: "Transfer" }));
    await waitFor(() => expect(onTransferred).toHaveBeenCalled());
    expect(bodies.at(-1)).toEqual({ owner_id: OTTO.id });
  });

  it("saves the changes to an existing search", async () => {
    const user = userEvent.setup();
    const { onSaved } = open({ search: savedViews[0] as unknown as SavedSearch });
    const name = await screen.findByDisplayValue(savedViews[0]!.name);
    await user.clear(name);
    await user.type(name, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: "Renamed" })));
  });
});
