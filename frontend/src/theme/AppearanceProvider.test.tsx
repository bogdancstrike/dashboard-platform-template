import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { STORAGE_KEYS } from "@/config";
import { renderWithProviders } from "@/test/render";
import { useAppearance } from "@/theme/AppearanceProvider";

function Probe() {
  const { appearance, density, mode, setAppearance, setDensity } = useAppearance();
  return (
    <div>
      <span data-testid="state">{`${appearance}/${mode}/${density}`}</span>
      <button onClick={() => setAppearance("dark")}>go dark</button>
      <button onClick={() => setDensity("compact")}>go compact</button>
    </div>
  );
}

describe("appearance and density", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-density");
  });

  it("defaults to following the operating system", () => {
    renderWithProviders(<Probe />);
    expect(screen.getByTestId("state")).toHaveTextContent("system/light/middle");
  });

  it("remembers the appearance and tells the browser about it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Probe />);

    await user.click(screen.getByText("go dark"));

    expect(window.localStorage.getItem(STORAGE_KEYS.appearance)).toBe("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    // Without this the browser paints form controls and scrollbars light on a
    // dark page — the classic tell that dark mode was added afterwards.
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("remembers the density", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Probe />);

    await user.click(screen.getByText("go compact"));

    expect(window.localStorage.getItem(STORAGE_KEYS.density)).toBe("compact");
    expect(document.documentElement.dataset["density"]).toBe("compact");
  });

  it("writes the tokens as CSS variables for everything outside AntD", () => {
    renderWithProviders(<Probe />);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--nu-accent")).toBe("#5b5bd6");
    expect(root.style.getPropertyValue("--nu-row-height")).toBe("40px");
  });

  it("changes the row height with the density, so the whole page rescales", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Probe />);

    await user.click(screen.getByText("go compact"));
    expect(document.documentElement.style.getPropertyValue("--nu-row-height")).toBe("32px");
  });
});
