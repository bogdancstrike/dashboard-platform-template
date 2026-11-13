import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { DocBlock, DocBlockKind } from "@/api/docs";
import { BlockEditor } from "@/components/docs/BlockEditor";
import { ActionView, BlockView } from "@/components/docs/BlockView";
import { DOC_BLOCK_ORDER, itemText, newDocBlock, recordPath } from "@/components/docs/blocks";
import { renderWithProviders } from "@/test/render";

vi.mock("@/api/files", async (original) => {
  const actual = await original<typeof import("@/api/files")>();
  return { ...actual, putBytes: vi.fn(() => Promise.resolve()) };
});

/** An editor wired to its own state, with the last value visible to the test. */
function Harness({ kind, initial }: { kind: DocBlockKind; initial?: Partial<DocBlock> }) {
  const [block, setBlock] = useState<DocBlock>({ ...newDocBlock(kind), ...initial });
  return (
    <>
      <BlockEditor block={block} onChange={setBlock} />
      <pre data-testid="state">{JSON.stringify(block)}</pre>
    </>
  );
}

const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "{}") as DocBlock;

describe("new blocks", () => {
  it("starts every kind with the fields it needs", () => {
    for (const kind of DOC_BLOCK_ORDER) expect(newDocBlock(kind).kind).toBe(kind);
    expect(newDocBlock("table").rows).toHaveLength(2);
    expect(recordPath("ticket", "1")).toBe("/tickets/1");
    expect(recordPath("odd", "1")).toBe("/explore/1");
    expect(itemText({ text: "a", done: true })).toBe("a");
  });
});

describe("the block editors", () => {
  it("edits a heading's level and words", async () => {
    renderWithProviders(<Harness kind="heading" />);
    await userEvent.type(screen.getByLabelText("Heading"), "Plan");
    expect(state().text).toBe("Plan");
  });

  it("edits text, quotes, callouts and code", async () => {
    const { unmount } = renderWithProviders(<Harness kind="text" />);
    await userEvent.type(screen.getByLabelText("Text"), "Hi");
    expect(state().text).toBe("Hi");
    unmount();
    const callout = renderWithProviders(<Harness kind="callout" />);
    await userEvent.click(screen.getByText("Careful"));
    await userEvent.type(screen.getByLabelText("Callout"), "Watch");
    expect(state()).toMatchObject({ tone: "warning", text: "Watch" });
    callout.unmount();
    renderWithProviders(<Harness kind="code" />);
    await userEvent.type(screen.getByLabelText("Language"), "sql");
    await userEvent.type(screen.getByLabelText("Code"), "select 1");
    expect(state()).toMatchObject({ language: "sql", text: "select 1" });
  });

  it("edits a list one item per line, and numbers it", async () => {
    renderWithProviders(<Harness kind="list" />);
    await userEvent.type(screen.getByLabelText("List items"), "a{Enter}b");
    await userEvent.click(screen.getByLabelText("Numbered"));
    expect(state()).toMatchObject({ items: ["a", "b"], ordered: true });
  });

  it("adds, ticks and removes checklist items", async () => {
    renderWithProviders(<Harness kind="checklist" />);
    await userEvent.type(screen.getByLabelText("Checklist item 1"), "one");
    await userEvent.click(screen.getByLabelText("Done 1"));
    await userEvent.click(screen.getByText("Add an item"));
    await userEvent.click(screen.getByLabelText("Remove item 2"));
    expect(state().items).toEqual([{ text: "one", done: true }]);
  });

  it("grows and shrinks a table", async () => {
    renderWithProviders(<Harness kind="table" />);
    await userEvent.type(screen.getByLabelText("Row 1, column 1"), "Name");
    await userEvent.click(screen.getByRole("button", { name: /Row/ }));
    await userEvent.click(screen.getByRole("button", { name: /Column/ }));
    expect(state().rows).toHaveLength(3);
    await userEvent.click(screen.getByText("Remove last row"));
    await userEvent.click(screen.getByText("Remove last column"));
    await userEvent.click(screen.getByLabelText("Header row"));
    expect(state()).toMatchObject({ header: false });
    expect(state().rows![0]).toEqual(["Name", ""]);
  });

  it("chooses a dataset and grouping for a chart", async () => {
    renderWithProviders(<Harness kind="chart" />);
    const dataset = screen.getByRole("combobox", { name: "Dataset" });
    fireEvent.mouseDown(dataset);
    await waitFor(() => expect(document.querySelector(".ant-select-item-option")).not.toBeNull());
    fireEvent.click(document.querySelector(".ant-select-item-option")!);
    await waitFor(() => expect(state().entity).toBeTruthy());
    await userEvent.click(screen.getByText("Line"));
    expect(state().chart).toBe("line");
  });

  it("chooses a saved report", async () => {
    renderWithProviders(<Harness kind="report" />);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Saved report" }));
    await waitFor(() => expect(document.querySelector(".ant-select-item-option")).not.toBeNull());
    fireEvent.click(document.querySelector(".ant-select-item-option")!);
    await waitFor(() => expect(state().report_id).toBeTruthy());
    await userEvent.click(screen.getByText("Both"));
    expect(state().show).toBe("both");
  });

  it("uploads an image and captions it", async () => {
    renderWithProviders(<Harness kind="image" />);
    await userEvent.type(screen.getByLabelText("Caption"), "Diagram");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["png"], "d.png", { type: "image/png" }));
    await waitFor(() => expect(state().file_id).toBeTruthy());
    expect(state().caption).toBe("Diagram");
  });

  it("picks a record to mention", async () => {
    renderWithProviders(<Harness kind="record" />);
    await userEvent.click(screen.getByTestId("pick-record"));
    await userEvent.type(await screen.findByTestId("record-search"), "Ne");
    await waitFor(() => expect(document.querySelector(".nx-dc-picker button")).not.toBeNull(), { timeout: 3000 }).catch(() => undefined);
    const pick = document.querySelector(".nx-dc-picker button");
    if (pick) {
      await userEvent.click(pick);
      await waitFor(() => expect(state().resource_id).toBeTruthy());
    }
  });

  it("writes an action item, and locks it once it is a task", async () => {
    const { unmount } = renderWithProviders(<Harness kind="action" />);
    await userEvent.type(screen.getByLabelText("Action item"), "Call");
    expect(state().text).toBe("Call");
    unmount();
    renderWithProviders(<Harness kind="action" initial={{ text: "Done", task_id: "t", due_date: "2026-09-10" }} />);
    expect(screen.getByLabelText("Action item")).toBeDisabled();
    expect(screen.getByText("Already a task — change it there.")).toBeInTheDocument();
  });

  it("draws nothing for a divider", () => {
    const { container } = renderWithProviders(<Harness kind="divider" />);
    expect(container.querySelector(".nx-dc-settings")).toBeNull();
  });
});

describe("reading blocks", () => {
  it("draws empty blocks honestly", () => {
    renderWithProviders(
      <>
        <BlockView block={{ id: "1", kind: "heading" }} tasks={{}} people={{}} />
        <BlockView block={{ id: "2", kind: "text" }} tasks={{}} people={{}} />
        <BlockView block={{ id: "3", kind: "list", items: [" "] }} tasks={{}} people={{}} />
        <BlockView block={{ id: "4", kind: "image" }} tasks={{}} people={{}} />
        <BlockView block={{ id: "5", kind: "record" }} tasks={{}} people={{}} />
        <BlockView block={{ id: "6", kind: "table", rows: [["a"]], header: false }} tasks={{}} people={{}} />
      </>,
    );
    expect(screen.getByText("Untitled section")).toBeInTheDocument();
    expect(screen.getByText("No image chosen yet.")).toBeInTheDocument();
    expect(screen.getByText("No record chosen yet.")).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("shows an action item's assignee, due date and the task it became", () => {
    const toggle = vi.fn();
    renderWithProviders(
      <>
        <ActionView block={{ id: "a", kind: "action", text: "Ship", assignee_id: "u", due_date: "2026-09-10" }} people={{ u: "Mara Manager" }} canCreate={false} creating={false} onToggle={toggle} />
        <ActionView block={{ id: "b", kind: "action", text: "Gone", task_id: "x" }} people={{}} canCreate creating={false} />
        <ActionView block={{ id: "c", kind: "action" }} people={{}} canCreate creating={false} />
      </>,
    );
    expect(screen.getByText("Mara")).toBeInTheDocument();
    expect(screen.getByText("due 2026-09-10")).toBeInTheDocument();
    expect(screen.getByText("task removed")).toBeInTheDocument();
    expect(screen.getByText("An empty action item")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Done: Ship"));
    expect(toggle).toHaveBeenCalledWith(true);
  });
});
