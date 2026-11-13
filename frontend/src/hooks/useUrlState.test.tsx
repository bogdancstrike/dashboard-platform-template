import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigationType } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { applyParamChanges, useUrlState } from "./useUrlState";

describe("applyParamChanges", () => {
  it("sets values, removes empty ones and leaves the rest alone", () => {
    const next = applyParamChanges(new URLSearchParams("a=1&b=2&c=3"), {
      a: "x",
      b: null,
      c: "",
      d: 4,
      e: undefined,
    });
    expect(next.toString()).toBe("a=x&d=4");
  });

  it("does not modify the params it was given", () => {
    const current = new URLSearchParams("a=1");
    applyParamChanges(current, { a: null });
    expect(current.get("a")).toBe("1");
  });
});

describe("useUrlState", () => {
  function setup(places?: string[]) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={["/page?q=old"]}>{children}</MemoryRouter>
    );
    return renderHook(() => ({ ...useUrlState(places), how: useNavigationType() }), { wrapper });
  }

  it("replaces for an adjustment", () => {
    const hook = setup(["board"]);
    act(() => hook.result.current.set({ q: "new" }));
    expect(hook.result.current.params.get("q")).toBe("new");
    expect(hook.result.current.how).toBe("REPLACE");
  });

  it("pushes when a place is set, and honours an explicit replace", () => {
    const hook = setup(["board"]);
    act(() => hook.result.current.set({ board: "b1" }));
    expect(hook.result.current.params.get("board")).toBe("b1");
    expect(hook.result.current.how).toBe("PUSH");
    act(() => hook.result.current.set({ board: "b2" }, { replace: true }));
    expect(hook.result.current.how).toBe("REPLACE");
    act(() => hook.result.current.set({ board: null }));
    expect(hook.result.current.params.has("board")).toBe(false);
    expect(hook.result.current.how).toBe("REPLACE");
  });

  it("replaces everything when no places are named", () => {
    const hook = setup();
    act(() => hook.result.current.set({ board: "b1" }));
    expect(hook.result.current.how).toBe("REPLACE");
  });
});
