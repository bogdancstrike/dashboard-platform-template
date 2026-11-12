import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useUrlOverlay } from "./useUrlOverlay";

function setup(initial: string[], index?: number) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initial} initialIndex={index}>
      {children}
    </MemoryRouter>
  );
  return renderHook(
    () => {
      const overlay = useUrlOverlay("group");
      const location = useLocation();
      return { overlay, location };
    },
    { wrapper },
  );
}

describe("an overlay whose state is in the address", () => {
  it("pushes on open, and closing goes back to where the reader was", () => {
    const { result } = setup(["/admin/groups?q=ops"]);
    expect(result.current.overlay.value).toBeNull();

    act(() => result.current.overlay.open("g-1"));
    expect(result.current.overlay.value).toBe("g-1");
    expect(result.current.location.search).toContain("q=ops");

    act(() => result.current.overlay.close());
    expect(result.current.overlay.value).toBeNull();
    expect(result.current.location.search).toBe("?q=ops");
  });

  it("closes a pasted link in place rather than leaving the page", () => {
    const { result } = setup(["/home", "/admin/groups?group=g-9"], 1);
    expect(result.current.overlay.value).toBe("g-9");
    act(() => result.current.overlay.close());
    expect(result.current.location.pathname).toBe("/admin/groups");
    expect(result.current.overlay.value).toBeNull();
  });
});
