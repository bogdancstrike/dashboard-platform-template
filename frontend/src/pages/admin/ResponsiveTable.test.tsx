import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResponsiveTable } from "@/pages/admin/ResponsiveTable";
import { renderWithProviders } from "@/test/render";
import { restoreViewport, viewport } from "@/test/viewport";

/**
 * A table on a desk, cards on a phone (§3) — the same rows, click and pages.
 */
interface Row {
  id: string;
  name: string;
  role: string;
  seen: string;
}
const ROWS: Row[] = [
  { id: "u-1", name: "Ada Administrator", role: "admin", seen: "2m" },
  { id: "u-2", name: "Zoë Ünicode-Łukasz", role: "viewer", seen: "3d" },
];
const columns = [
  { title: "Name", dataIndex: "name", key: "name" },
  { title: "Role", dataIndex: "role", key: "role" },
];
const card = (row: Row) => ({ title: row.name, meta: row.role, pill: <span>{row.role}</span>, right: row.seen, lead: <i>{row.name[0]}</i> });

afterEach(restoreViewport);

describe("on a desk", () => {
  it("is the AntD table, columns and all", () => {
    viewport("pc");
    renderWithProviders(<ResponsiveTable<Row> rowKey="id" columns={columns} dataSource={ROWS} card={card} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Role" })).toBeInTheDocument();
  });
});

describe("on a phone", () => {
  it("draws each row as a card, and a row with a click is a button", async () => {
    viewport("phone");
    const opened: string[] = [];
    renderWithProviders(
      <ResponsiveTable<Row>
        rowKey="id"
        columns={columns}
        dataSource={ROWS}
        card={card}
        onRow={(row) => ({ onClick: () => opened.push(row.id) })}
        {...{ "data-testid": "people" }}
      />,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const list = screen.getByTestId("people");
    const cards = within(list).getAllByRole("button");
    expect(cards).toHaveLength(2);
    expect(cards[1]).toHaveTextContent("Zoë Ünicode-Łukasz");
    expect(cards[1]).toHaveTextContent("3d");
    await userEvent.click(cards[1]!);
    expect(opened).toEqual(["u-2"]);
  });

  it("is a plain card when the row does nothing, keyed by a function or the index", () => {
    viewport("phone");
    const { rerender } = renderWithProviders(
      <ResponsiveTable<Row> rowKey={(row) => row.id} columns={columns} dataSource={ROWS} card={(row) => ({ title: row.name })} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Ada Administrator")).toBeInTheDocument();
    rerender(<ResponsiveTable<Row> columns={columns} dataSource={[{ ...ROWS[0]!, id: undefined as unknown as string }]} card={(row) => ({ title: row.name })} />);
    expect(screen.getByText("Ada Administrator")).toBeInTheDocument();
  });

  it("shows a skeleton while the first page loads, and the table's own empty text", () => {
    viewport("phone");
    const { container, rerender } = renderWithProviders(
      <ResponsiveTable<Row> rowKey="id" columns={columns} dataSource={[]} loading={{ spinning: true }} card={card} />,
    );
    expect(container.querySelector(".ant-skeleton")).not.toBeNull();
    rerender(<ResponsiveTable<Row> rowKey="id" columns={columns} dataSource={[]} locale={{ emptyText: "Nobody yet" }} card={card} />);
    expect(screen.getByText("Nobody yet")).toBeInTheDocument();
    rerender(<ResponsiveTable<Row> rowKey="id" columns={columns} dataSource={[]} locale={{ emptyText: () => "Nobody matches" }} card={card} />);
    expect(screen.getByText("Nobody matches")).toBeInTheDocument();
  });

  it("pages through its own pagination, or the table's onChange when it has none", async () => {
    viewport("phone");
    const onPage = vi.fn();
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <ResponsiveTable<Row> rowKey="id" columns={columns} dataSource={ROWS} card={card} pagination={{ current: 1, pageSize: 2, total: 9, onChange: onPage }} />,
    );
    await userEvent.click(screen.getByTitle("Next Page"));
    expect(onPage).toHaveBeenCalledWith(2, 2);

    rerender(<ResponsiveTable<Row> rowKey="id" columns={columns} dataSource={ROWS} card={card} pagination={{ current: 1, pageSize: 2, total: 9 }} onChange={onChange} />);
    await userEvent.click(screen.getByTitle("Next Page"));
    expect(onChange.mock.calls[0]![0]).toEqual({ current: 2, pageSize: 2 });

    // One page needs no pager.
    rerender(<ResponsiveTable<Row> rowKey="id" columns={columns} dataSource={ROWS} card={card} pagination={{ current: 1, pageSize: 25, total: 2 }} />);
    expect(screen.queryByTitle("Next Page")).not.toBeInTheDocument();
  });
});
