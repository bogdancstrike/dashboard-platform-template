import { describe, expect, it } from "vitest";

import { NAV_GROUPS, selectedKeyFor, trailFor } from "./navigation";

describe("find and analytics navigation", () => {
  it("offers the explorer and focused discovery tools", () => {
    const find = NAV_GROUPS.find((group) => group.key === "find");

    expect(find?.items.map((item) => [item.key, item.label])).toEqual([
      ["/explore", "Data Explorer"],
      ["/find/global", "Global search"],
      ["/find/relationships", "Relationships"],
      ["/find/catalog", "Data catalog"],
      ["/favorites", "Favorites"],
    ]);
  });

  it("places Analytics in the analysis workspace", () => {
    const analyse = NAV_GROUPS.find((group) => group.key === "analyse");
    expect(analyse?.items[0]).toMatchObject({ key: "/analytics", label: "Analytics" });
  });

  it("keeps nested discovery URLs selected and breadcrumbed", () => {
    expect(selectedKeyFor("/find/relationships/customer-42")).toBe("/find/relationships");
    expect(trailFor("/find/catalog/projects").map((part) => part.label)).toEqual([
      "Find",
      "Data catalog",
    ]);
  });

  it("selects valid routes that are shorter than /dashboard", () => {
    expect(selectedKeyFor("/admin")).toBe("/admin");
    expect(selectedKeyFor("/mail/thread-1")).toBe("/mail");
  });
});
