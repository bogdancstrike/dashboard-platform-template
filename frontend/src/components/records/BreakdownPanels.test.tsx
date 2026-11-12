import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BarPanel, StatePanel, TriageTile } from "@/components/records/BreakdownPanels";

describe("the breakdown panels", () => {
  it("draws a bar per value, longest first, with the remainder last", () => {
    render(
      <BarPanel
        title="By site"
        series={[
          { name: "218 others", value: 231 },
          { name: "Munich — Warehouse", value: 3 },
          { name: "Bern yard", value: 9 },
        ]}
        onSelect={() => undefined}
      />,
    );
    const rows = screen.getAllByRole("button").map((button) => button.textContent);
    expect(rows[0]).toContain("Bern yard");
    expect(rows[1]).toContain("Munich — Warehouse");
    expect(rows[2]).toContain("218 others");
  });

  it("is a filter: a press selects the value, a second press lets it go", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <BarPanel title="By kind" series={[{ name: "SENSOR", value: 4 }]} onSelect={onSelect} />,
    );
    await user.click(screen.getByRole("button", { name: /Sensor: 4/ }));
    expect(onSelect).toHaveBeenLastCalledWith("SENSOR");

    rerender(
      <BarPanel
        title="By kind"
        series={[{ name: "SENSOR", value: 4 }]}
        active="SENSOR"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole("button", { name: /Sensor/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /Sensor/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("splits one strip by state and lists the states under it", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <StatePanel
        title="Fleet by state"
        series={[
          { name: "ONLINE", value: 9 },
          { name: "OFFLINE", value: 1 },
        ]}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Online 9, Offline 1");
    await user.click(screen.getByRole("button", { name: /Offline/ }));
    expect(onSelect).toHaveBeenCalledWith("OFFLINE");
  });

  it("says when there is nothing to count", () => {
    render(<StatePanel title="Fleet by state" series={[]} onSelect={() => undefined} />);
    expect(screen.getByText("Nothing to count yet.")).toBeInTheDocument();
  });

  it("offers the records behind a triage count", async () => {
    const user = userEvent.setup();
    const onShow = vi.fn();
    render(<TriageTile count={40} title="Down" detail="Offline right now" tone="bad" onShow={onShow} />);
    await user.click(screen.getByRole("button", { name: /40 Down/ }));
    expect(onShow).toHaveBeenCalled();
  });
});
