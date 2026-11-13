import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { GridColumn } from "@/lib/gridSheet";
import { ra, resetRecordsAnalytics } from "@/test/handlers/recordsAnalytics";
import { renderWithProviders } from "@/test/render";

import { RecordGrid, type GridRow } from "./RecordGrid";

const columns: GridColumn[] = [
  { name: "name", label: "Name", kind: "text", editable: true, required: true },
  { name: "status", label: "Status", kind: "enum", editable: true, choices: ["ACTIVE", "INACTIVE", "BLOCKED"] },
  { name: "satisfaction", label: "Satisfaction", kind: "number", editable: true, minimum: 0, maximum: 10 },
  { name: "last_contact_at", label: "Last contact", kind: "datetime", editable: true },
  { name: "vip", label: "VIP", kind: "bool", editable: true },
  { name: "code", label: "Code", kind: "text", editable: false },
];

const rows: GridRow[] = Array.from({ length: 6 }, (_, i) => ({
  id: `c-${i}`, name: `Customer ${i}`, status: "ACTIVE", satisfaction: 5, last_contact_at: "2026-09-01T00:00:00Z",
  vip: false, code: `CUS-${i}`, updated_at: "2026-09-01T00:00:00Z",
}));

function setup(canEdit = true) {
  renderWithProviders(
    <RecordGrid resourceType="customer" columns={columns} rows={rows} titleField="name" canEdit={canEdit} height={500} />,
  );
  return screen.getByTestId("record-grid");
}

const cell = (r: number, c: number) => document.querySelector(`[data-cell="${r}:${c}"]`) as HTMLElement;

function paste(grid: HTMLElement, text: string) {
  fireEvent.paste(grid, { clipboardData: { getData: () => text } });
}

beforeEach(() => resetRecordsAnalytics());

describe("RecordGrid", () => {
  it("pastes a 3×4 block from Excel, coercing every cell, and saves it per row", async () => {
    const grid = setup();
    fireEvent.mouseDown(cell(1, 0));
    paste(grid, "Alpha\tblocked\t9\t03/09/2026\nBeta\tInactive\t€7\t2026-09-04\nGamma\tactive\t8,5\t5.9.2026\n");
    expect(cell(1, 0)).toHaveTextContent("Alpha");
    expect(cell(2, 1)).toHaveTextContent("Inactive");
    expect(cell(3, 2)).toHaveTextContent("8.5");
    expect(cell(3, 3)).toHaveTextContent("2026-09-05");
    expect(cell(1, 0)).toHaveClass("is-pending");
    expect(screen.getByTestId("grid-pending")).toHaveTextContent("11 pending in 3 rows");

    fireEvent.click(screen.getByTestId("grid-save"));
    await waitFor(() => expect(ra.gridSaves).toHaveLength(1));
    expect(ra.gridSaves[0]).toEqual([
      { id: "c-1", changes: { name: "Alpha", status: "BLOCKED", satisfaction: 9, last_contact_at: "2026-09-03" }, expected_updated_at: "2026-09-01T00:00:00Z" },
      { id: "c-2", changes: { name: "Beta", status: "INACTIVE", satisfaction: 7, last_contact_at: "2026-09-04" }, expected_updated_at: "2026-09-01T00:00:00Z" },
      { id: "c-3", changes: { name: "Gamma", satisfaction: 8.5, last_contact_at: "2026-09-05" }, expected_updated_at: "2026-09-01T00:00:00Z" },
    ]);
    await waitFor(() => expect(screen.queryByTestId("grid-pending")).not.toBeInTheDocument());
    expect(cell(1, 0)).toHaveTextContent("Alpha");
  });

  it("marks cells it cannot coerce and does not send them", () => {
    const grid = setup();
    fireEvent.mouseDown(cell(0, 2));
    paste(grid, "eleven\n42");
    expect(cell(0, 2)).toHaveClass("is-invalid");
    expect(cell(0, 2)).toHaveAttribute("title", "“eleven” is not a number.");
    expect(cell(1, 2)).toHaveAttribute("title", "Satisfaction must be at most 10.");
    expect(screen.getByTestId("grid-invalid")).toHaveTextContent("2 invalid");
    expect(screen.getByTestId("grid-save")).toBeDisabled();
  });

  it("skips what lands outside the grid or on a locked column", () => {
    const grid = setup();
    fireEvent.mouseDown(cell(5, 4));
    paste(grid, "yes\tX\nno\tY");
    expect(cell(5, 4)).toHaveTextContent("Yes");
    expect(cell(5, 5)).toHaveTextContent("CUS-5");
  });

  it("puts the server's reason on a refused cell", async () => {
    const grid = setup();
    fireEvent.mouseDown(cell(0, 0));
    paste(grid, "REFUSE\nFine");
    fireEvent.click(screen.getByTestId("grid-save"));
    await waitFor(() => expect(cell(0, 0)).toHaveAttribute("title", "That name is taken."));
    expect(cell(0, 0)).toHaveClass("is-invalid");
    expect(cell(1, 0)).not.toHaveClass("is-pending");
  });

  it("edits with the keyboard: type, Enter moves down, Escape cancels, Tab moves right", () => {
    const grid = setup();
    fireEvent.mouseDown(cell(0, 0));
    fireEvent.keyDown(grid, { key: "Z" });
    const input = within(cell(0, 0)).getByRole("textbox");
    fireEvent.change(input, { target: { value: "Zeta" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(cell(0, 0)).toHaveTextContent("Zeta");
    expect(cell(1, 0)).toHaveClass("is-active");

    fireEvent.keyDown(grid, { key: "F2" });
    const second = within(cell(1, 0)).getByRole("textbox");
    fireEvent.change(second, { target: { value: "nope" } });
    fireEvent.keyDown(second, { key: "Escape" });
    expect(cell(1, 0)).toHaveTextContent("Customer 1");

    fireEvent.keyDown(grid, { key: "Enter" });
    const third = within(cell(1, 0)).getByRole("textbox");
    fireEvent.keyDown(third, { key: "Tab" });
    expect(cell(1, 1)).toHaveClass("is-active");
    fireEvent.keyDown(grid, { key: "Tab", shiftKey: true });
    expect(cell(1, 0)).toHaveClass("is-active");
  });

  it("edits a status with a select and a yes/no with a select", () => {
    const grid = setup();
    fireEvent.mouseDown(cell(0, 1));
    fireEvent.doubleClick(cell(0, 1));
    const select = within(cell(0, 1)).getByRole("combobox");
    fireEvent.change(select, { target: { value: "Blocked" } });
    fireEvent.blur(select);
    expect(cell(0, 1)).toHaveTextContent("Blocked");
    fireEvent.mouseDown(cell(0, 4));
    fireEvent.keyDown(grid, { key: "Enter" });
    const flag = within(cell(0, 4)).getByRole("combobox");
    fireEvent.change(flag, { target: { value: "Yes" } });
    fireEvent.keyDown(flag, { key: "Enter" });
    expect(cell(0, 4)).toHaveTextContent("Yes");
  });

  it("moves and selects with arrows, fills down, clears, undoes and redoes", () => {
    const grid = setup();
    fireEvent.mouseDown(cell(0, 2));
    fireEvent.keyDown(grid, { key: "Enter" });
    const input = within(cell(0, 2)).getByRole("textbox");
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    expect(cell(2, 2)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(grid, { key: "d", ctrlKey: true });
    expect(cell(1, 2)).toHaveTextContent("2");
    expect(cell(2, 2)).toHaveTextContent("2");

    fireEvent.keyDown(grid, { key: "z", ctrlKey: true });
    expect(cell(2, 2)).toHaveTextContent("5");
    fireEvent.keyDown(grid, { key: "y", ctrlKey: true });
    expect(cell(2, 2)).toHaveTextContent("2");
    fireEvent.keyDown(grid, { key: "z", ctrlKey: true, shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));

    fireEvent.keyDown(grid, { key: "Delete" });
    expect(cell(1, 2)).toHaveTextContent("");
    fireEvent.keyDown(grid, { key: "ArrowRight", ctrlKey: true });
    expect(cell(2, 5)).toHaveClass("is-active");
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    fireEvent.keyDown(grid, { key: "Escape" });
    fireEvent.keyDown(grid, { key: "a", ctrlKey: true });
    expect(cell(5, 5)).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByTestId("grid-pending")).not.toBeInTheDocument();
  });

  it("selects by dragging and copies the block as TSV", () => {
    const grid = setup();
    fireEvent.mouseDown(cell(0, 0));
    fireEvent.mouseEnter(cell(1, 1));
    fireEvent.mouseUp(grid);
    let copied = "";
    fireEvent.copy(grid, { clipboardData: { setData: (_: string, text: string) => (copied = text) } });
    expect(copied).toBe("Customer 0\tActive\nCustomer 1\tActive");
    fireEvent.mouseDown(cell(3, 0), { shiftKey: true });
    expect(cell(2, 0)).toHaveAttribute("aria-selected", "true");
  });

  it("saves with Ctrl+S and scrolls", async () => {
    const grid = setup();
    fireEvent.mouseDown(cell(0, 0));
    paste(grid, "Saved by keys");
    fireEvent.keyDown(grid, { key: "s", ctrlKey: true });
    await waitFor(() => expect(ra.gridSaves).toHaveLength(1));
    act(() => {
      grid.scrollTop = 100;
      fireEvent.scroll(grid);
    });
  });

  it("is read-only without the permission", () => {
    const grid = setup(false);
    fireEvent.mouseDown(cell(0, 0));
    paste(grid, "x");
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(within(cell(0, 0)).queryByRole("textbox")).toBeNull();
    expect(cell(0, 0)).toHaveTextContent("Customer 0");
  });
});
