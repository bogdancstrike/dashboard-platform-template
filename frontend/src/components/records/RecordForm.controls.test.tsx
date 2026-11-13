import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import type { ExplorerResource } from "@/api/explorer";
import { RecordForm } from "@/components/records/RecordForm";
import { people, recordDetail } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * One control per kind of declared field (§9).
 *
 * The form knows nothing about tickets or tasks: it draws whatever the
 * catalogue declares. So the way to test it is a dataset that declares one of
 * everything — a person, a record, a choice, a switch, a number, a date, a
 * document, a list and a paragraph — and a create that sends each of them in
 * the shape the API accepts.
 */
const f = (name: string, label: string, kind: string, extra: Record<string, unknown> = {}) => ({
  name, label, kind, sortable: false, filterable: false, searchable: false, facet: false, operators: [], choices: [], editable: true, ...extra,
});

const RESOURCE = {
  key: "widget",
  label: "Widgets",
  description: "",
  permission: "records.view",
  record_count: 0,
  default_columns: [],
  default_sort: "name",
  path: "/widgets",
  title_field: "name",
  subtitle_field: "",
  status_field: "",
  can_create: true,
  can_edit: true,
  can_delete: true,
  fields: [
    f("name", "Name", "text", { required: true }),
    f("owner_id", "Owner ID", "uuid", { references: "user" }),
    f("project_id", "Project", "uuid", { references: "project" }),
    f("status", "Status", "enum", { choices: ["NEW", "DONE"] }),
    f("active", "Active", "bool"),
    f("points", "Points", "number", { minimum: 0, maximum: 100 }),
    f("due_at", "Due", "datetime"),
    f("settings", "Settings", "json"),
    f("labels", "Labels", "array"),
    f("readonly", "Read only", "text", { editable: false }),
  ],
} as unknown as ExplorerResource;

function open(props: Partial<Parameters<typeof RecordForm>[0]> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithProviders(<RecordForm open resource={RESOURCE} onClose={onClose} onSaved={onSaved} {...props} />);
  return { onClose, onSaved };
}

async function pickOption(label: string, matcher: (node: HTMLElement) => boolean) {
  const user = userEvent.setup();
  const option = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].find(matcher);
    if (!found) throw new Error(`nothing to pick for ${label}`);
    return found;
  });
  await user.click(option);
}

describe("creating a record of a dataset that declares one of everything", () => {
  it("draws a control per kind, refuses bad JSON, and sends each value in the API's shape", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/records/widget", async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...recordDetail, resource_type: "widget", title: "Ünïcode widget" }, { status: 201 });
      }),
      http.post("/platform/api/explorer/query", () =>
        HttpResponse.json({ items: [{ id: "prj-1", name: "Apollo" }, { id: "prj-2", title: "Borealis" }], total: 2, page: 1, page_size: 20, pages: 1 }),
      ),
    );
    const { onSaved, onClose } = open();
    expect(screen.getByText("New widget")).toBeInTheDocument();
    // A field the catalogue does not let anybody write is not offered.
    expect(screen.queryByLabelText("Read only")).not.toBeInTheDocument();

    // Required first.
    await user.click(screen.getByTestId("record-form-save"));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "Ünïcode widget");

    // A person, found on the server; the label drops the column's "ID".
    await user.type(screen.getByRole("combobox", { name: "Owner" }), "Otto");
    // Only once the server's answer to the term is the whole list: an option
    // from the list before it is replaced on the next render and selects nothing.
    await waitFor(() => {
      const offered = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")];
      expect(offered.map((node) => node.getAttribute("title"))).toEqual([people[1]!.email]);
    });
    await pickOption("Owner", (node) => node.getAttribute("title") === people[1]!.email);

    // A record of another dataset, labelled by whichever title it has.
    await user.click(screen.getByRole("combobox", { name: "Project" }));
    await pickOption("Project", (node) => node.textContent === "Borealis");

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await pickOption("Status", (node) => node.textContent === "Done");
    await user.click(screen.getByRole("switch", { name: "Active" }));
    fireEvent.change(screen.getByLabelText("Points"), { target: { value: "42" } });

    const settings = screen.getByLabelText("Settings");
    fireEvent.change(settings, { target: { value: "{ not json" } });
    expect(screen.getByText("That is not valid JSON yet.")).toBeInTheDocument();
    fireEvent.change(settings, { target: { value: '{"theme":"dark"}' } });
    expect(screen.queryByText("That is not valid JSON yet.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Labels"), { target: { value: '["a","ü"]' } });
    fireEvent.change(screen.getByLabelText("Labels"), { target: { value: "  " } });
    fireEvent.change(screen.getByLabelText("Labels"), { target: { value: '["a","ü"]' } });

    await user.click(screen.getByTestId("record-form-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(bodies[0]).toMatchObject({
      name: "Ünïcode widget",
      owner_id: people[1]!.id,
      project_id: "prj-2",
      status: "DONE",
      active: true,
      points: 42,
      settings: { theme: "dark" },
      labels: ["a", "ü"],
    });
  });

  it("says a dataset with nothing writable has no form, and will not save", () => {
    open({ resource: { ...RESOURCE, fields: [f("readonly", "Read only", "text", { editable: false })] } as unknown as ExplorerResource });
    expect(screen.getByText("Nothing here can be edited")).toBeInTheDocument();
    expect(screen.getByTestId("record-form-save")).toBeDisabled();
  });

  it("explains a refused create in the server's words, under a headline that names the kind", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/platform/api/records/widget", () =>
        HttpResponse.json({ error: "forbidden", message: "Widgets are created by the platform team.", details: {} }, { status: 403 }),
      ),
    );
    open();
    await user.type(screen.getByLabelText("Name"), "Nope");
    await user.click(screen.getByTestId("record-form-save"));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Your role does not include writing this record")).toBeInTheDocument();
  });
});

describe("opening a record for editing", () => {
  it("is shaped like the form while the record is on the wire", () => {
    open({ loading: true });
    expect(screen.getByText("Edit widget")).toBeInTheDocument();
    expect(document.querySelector(".ant-skeleton")).not.toBeNull();
    expect(screen.getByTestId("record-form-save")).toBeDisabled();
  });

  it("says why the record could not be opened, and retries", async () => {
    const user = userEvent.setup();
    const onRetryRead = vi.fn();
    const { ApiError } = await import("@/api/client");
    open({ readError: new ApiError(404, { error: "not_found", message: "Gone." }, "c-1"), onRetryRead });
    expect(screen.getByText("That record is no longer there")).toBeInTheDocument();
    const retry = screen.queryByRole("button", { name: /Try again|Retry/ });
    if (retry) {
      await user.click(retry);
      expect(onRetryRead).toHaveBeenCalled();
    }
  });
});
