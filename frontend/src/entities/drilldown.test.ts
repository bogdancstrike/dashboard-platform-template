import { describe, expect, it } from "vitest";

import { describeOrigin, readOrigin, withOrigin } from "@/entities/drilldown";

/**
 * The way back from a drill-down (§44).
 *
 * Pure, and worth its own tests for two reasons that are not about
 * convenience: the origin is a URL somebody can *edit*, so following it
 * blindly would make every page of this platform a one-click redirect to
 * anywhere — and nesting them would build a stack nobody asked for.
 */

describe("carrying where a drill-down came from", () => {
  it("keeps the picture's own state, because that is part of where they were", () => {
    const address = withOrigin("/projects?f.health=AT_RISK", "/dashboard?period=last_90_days");

    const params = new URLSearchParams(address.split("?")[1]);
    expect(params.get("from")).toBe("/dashboard?period=last_90_days");
    // And the drill's own filter is untouched.
    expect(params.get("f.health")).toBe("AT_RISK");
  });

  it("adds a query to a target that has none", () => {
    expect(withOrigin("/orders", "/analytics")).toBe("/orders?from=%2Fanalytics");
  });

  it("does not stack: a drill from a drill goes back one place, not two", () => {
    const first = withOrigin("/projects?f.health=AT_RISK", "/dashboard");
    const second = withOrigin("/tasks?f.project_id=abc", first);

    // The second hop's way back is the first hop's *page*, and nothing
    // deeper: a `from` inside a `from` is a stack the address bar cannot
    // explain to anybody.
    expect(readOrigin(second.split("?")[1]!)?.to).toBe("/projects?f.health=AT_RISK");
    expect(second.match(/from=/g)).toHaveLength(1);
  });
});

describe("reading it back", () => {
  it("names where it goes, in the words the navigation uses", () => {
    expect(readOrigin("from=%2Fdashboard")?.label).toBe("the dashboard");
    expect(readOrigin("from=%2Fanalytics%3Fdataset%3Dorder")?.label).toBe("the analysis");
    expect(readOrigin("from=%2Fadmin%2Fquality")?.label).toBe("the quality report");
    // Longest prefix wins, so `/find/global` is not "the explorer".
    expect(describeOrigin("/find/global?q=migration")).toBe("the search");
  });

  it("falls back to the address rather than inventing a name", () => {
    expect(describeOrigin("/somewhere/new")).toBe("/somewhere/new");
  });

  it("is nothing at all when there is no origin", () => {
    expect(readOrigin("")).toBeNull();
    expect(readOrigin("from=")).toBeNull();
  });

  it("refuses anything that leaves the application", () => {
    // A `from` a reader can edit is a redirect anybody can paste into a
    // message; following one would make every page here a phishing gadget.
    expect(readOrigin("from=https%3A%2F%2Fevil.example")).toBeNull();
    // Protocol-relative, which a browser follows off-site.
    expect(readOrigin("from=%2F%2Fevil.example")).toBeNull();
    expect(readOrigin("from=javascript%3Aalert(1)")).toBeNull();
  });
});
