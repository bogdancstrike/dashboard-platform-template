import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PanelHeader } from "./PanelHeader";

describe("PanelHeader", () => {
  it("puts the title in a heading and the extra beside it", () => {
    const { container } = render(<PanelHeader title="Movers" extra={<span>12 in total</span>} />);
    expect(screen.getByRole("heading", { level: 2, name: "Movers" })).toBeInTheDocument();
    expect(screen.getByText("12 in total")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("nu-panel-head");
  });

  it("adds a caller's class and style", () => {
    const { container } = render(<PanelHeader title="Preview" className="extra" style={{ marginBottom: 4 }} />);
    expect(container.firstElementChild).toHaveAttribute("class", "nu-panel-head extra");
    expect(container.firstElementChild).toHaveStyle({ marginBottom: "4px" });
  });
});
