import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NxIcon } from "@/components/NxIcon";

import { AstIcon } from "./AstIcon";
import { ChartKindIcon } from "./ChartKindIcon";
import { CoIcon } from "./CoIcon";
import { FdIcon } from "./FdIcon";
import { KnIcon } from "./KnIcon";
import { PlanIcon } from "./PlanIcon";
import { TdIcon } from "./TdIcon";

const svg = (ui: React.ReactElement) => render(ui).container.querySelector("svg")!;

describe("the icon families", () => {
  it("all draw one hidden, round-stroked path in the text colour", () => {
    for (const icon of [
      <NxIcon key="nx" name="home" />,
      <KnIcon key="kn" name="documents" />,
      <TdIcon key="td" name="clock" />,
      <PlanIcon key="pl" name="sprint" />,
      <AstIcon key="as" name="spark" />,
      <CoIcon key="co" name="chat" />,
      <ChartKindIcon key="ck" kind="bar" />,
      <FdIcon key="fd" name="date" />,
    ]) {
      const element = svg(icon);
      expect(element).toHaveAttribute("aria-hidden", "true");
      expect(element).toHaveAttribute("stroke-linecap", "round");
      expect(element.querySelectorAll("path")).toHaveLength(1);
      expect(element.querySelector("path")!.getAttribute("d")).toBeTruthy();
    }
  });

  it("keeps each family's own defaults", () => {
    expect(svg(<NxIcon name="home" className="x" />)).toHaveAttribute("class", "nx-icon x");
    expect(svg(<NxIcon name="home" />)).toHaveAttribute("focusable", "false");
    expect(svg(<AstIcon name="spark" />)).toHaveAttribute("width", "16");
    expect(svg(<ChartKindIcon kind="scatter" />)).toHaveAttribute("stroke-width", "3.2");
    expect(svg(<ChartKindIcon kind="bar" />)).toHaveAttribute("stroke-width", "1.8");
    expect(svg(<TdIcon name="play" />)).toHaveAttribute("fill", "currentColor");
    expect(svg(<TdIcon name="clock" />)).toHaveAttribute("fill", "none");
    const solid = svg(<FdIcon name="date" fill />);
    expect(solid).toHaveAttribute("fill", "currentColor");
    expect(solid).toHaveAttribute("stroke", "none");
    expect(solid).not.toHaveAttribute("focusable");
    expect(svg(<FdIcon name="date" />)).toHaveAttribute("width", "15");
  });
});
