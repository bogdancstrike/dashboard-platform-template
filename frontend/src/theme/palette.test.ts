import { describe, expect, it } from "vitest";

import { buildChartTheme } from "@/theme/echarts";
import { buildTheme, cssVariables } from "@/theme/antd";
import { ACCENT, LOGO, PAPER, SEMANTIC, SERIES } from "@/theme/tokens";
import { shippedSources } from "@/test/sources";

/**
 * One palette, three consumers — and the acceptance the tracker wrote for it:
 * *changing the accent in one file re-themes the app, the charts and dark mode
 * with no other edit.*
 *
 * That is a claim about where colour comes *from*, and it is only true while
 * nothing types a colour of its own. Two tests, and they are opposite halves:
 * the three builders are asserted to read `tokens.ts`, and every shipped
 * module outside `src/theme/` is asserted to contain no colour at all.
 *
 * The second half found eight: the accent copied into the logo's SVG, the info
 * ink copied into the map's markers, `NEUTRAL[400]` copied into the graph's
 * muted node, and `#ffffff` typed six times in the theme layer itself. Each
 * one is a place a retuned palette would have left behind.
 */

describe("the three consumers all read the tokens", () => {
  it("takes AntD's primary from the accent", () => {
    // The one accent, in both appearances: the ramp changes, the source does
    // not.
    expect(buildTheme("light", "middle").token?.colorPrimary).toBe(ACCENT[500]);
    expect(buildTheme("dark", "middle").token?.colorPrimary).toBe(ACCENT[400]);
  });

  it("publishes the same accent as a CSS variable", () => {
    // The stylesheet cannot import TypeScript, so the variables are the bridge
    // — and a component resolving the theme in JavaScript to pick a hex would
    // be a second place the mode can be got wrong.
    expect(cssVariables("light", "middle")["--nu-accent"]).toBe(ACCENT[500]);
    expect(cssVariables("dark", "middle")["--nu-accent"]).toBe(ACCENT[400]);
  });

  it("gives the charts the same series palette and the same grounds", () => {
    const light = buildChartTheme("light", "middle");
    const dark = buildChartTheme("dark", "middle");

    // A chart themed by one system beside a table themed by another is a pair
    // that drifts exactly where a reader is comparing them.
    expect(light.color).toEqual([...SERIES]);
    expect(dark.color).toEqual([...SERIES]);
    expect(light.tooltip?.backgroundColor).toBe(PAPER);
  });

  it("carries the four meanings into every consumer", () => {
    const theme = buildTheme("light", "middle").token;
    expect(theme?.colorSuccess).toBe(SEMANTIC.success);
    expect(theme?.colorWarning).toBe(SEMANTIC.warning);
    expect(theme?.colorInfo).toBe(SEMANTIC.info);
    // `colorError` is the *fill*, which `contrast.test.ts` holds to white
    // text — the ink is a separate token for that reason.
    expect(theme?.colorError).toBe(SEMANTIC.danger);
    expect(cssVariables("light", "middle")["--nu-success"]).toBe(SEMANTIC.success);
  });

  it("keeps the logo out of it, on purpose", () => {
    // The one thing that must *not* follow the palette: a brand mark that
    // changes hue with the theme is not a brand mark. The dependency runs the
    // other way — the accent was taken from the logo.
    expect(LOGO.core).toBe(ACCENT[500]);
    expect(cssVariables("dark", "middle")["--nu-accent"]).not.toBe(LOGO.core);
  });
});

describe("no shipped module writes a colour of its own", () => {
  /** Source with comments removed, so a hex *quoted in prose* is not a colour. */
  function code(source: string): string[] {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""));
  }

  it("reads the application's own files at all", () => {
    const files = shippedSources(/\.tsx?$/).filter(
      (file) => !file.name.startsWith("theme/"),
    );
    expect(files.length).toBeGreaterThan(80);
  });

  it("has no hex literal outside src/theme", () => {
    // `src/theme/` is the layer that *builds* the themes from the tokens, and
    // `tokens.ts` is where the colours live. Everything else asks.
    const offenders: string[] = [];
    for (const file of shippedSources(/\.tsx?$/)) {
      if (file.name.startsWith("theme/")) continue;
      const lines = code(file.source);
      lines.forEach((line, index) => {
        for (const match of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
          // An explicit marker, on this line or the one above: the one honest
          // exception is copy that *names* a hex to a reader.
          const marked = [line, lines[index - 1] ?? "", file.source.split("\n")[index - 1] ?? ""]
            .join(" ")
            .includes("palette-exempt");
          if (!marked) offenders.push(`${file.name}:${index + 1} ${match[0]}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
