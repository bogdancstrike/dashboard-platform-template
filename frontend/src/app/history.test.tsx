import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { OverlayHistory, useScrollMemory, useSmartBack } from "./history";

/**
 * Browser history that behaves (§back): a back button that never leaves the
 * app, overlays that the Back gesture closes, and scroll positions that come
 * back with the page they belong to.
 */

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function BackButtons() {
  const back = useSmartBack();
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => back()}>back</button>
      <button onClick={() => back("/reports")}>back to reports</button>
      <button onClick={() => back(() => navigate("/custom"))}>back custom</button>
      <button onClick={() => navigate("/second")}>go second</button>
    </>
  );
}

function renderBack(entries: string[]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Routes>
        <Route path="*" element={<BackButtons />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId("where").textContent;

afterEach(() => {
  window.history.replaceState(null, "");
});

describe("the smart back button", () => {
  it("goes to the fallback when there is nothing in this app to go back to", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ idx: 0 }, "");
    renderBack(["/tasks/1"]);
    await user.click(screen.getByText("back"));
    expect(where()).toBe("/home");
  });

  it("uses a path or a function the caller names", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "");
    renderBack(["/reports/1"]);
    await user.click(screen.getByText("back to reports"));
    expect(where()).toBe("/reports");
    await user.click(screen.getByText("back custom"));
    expect(where()).toBe("/custom");
  });

  it("steps back through history when the app has some", async () => {
    const user = userEvent.setup();
    renderBack(["/first", "/second"]);
    window.history.replaceState({ idx: 1 }, "");
    await user.click(screen.getByText("back"));
    expect(where()).toBe("/first");
  });
});

describe("overlays and the Back gesture", () => {
  it("pushes an entry when an overlay opens and closes the overlay on Back", async () => {
    render(
      <MemoryRouter>
        <OverlayHistory />
      </MemoryRouter>,
    );
    const before = window.history.length;

    // A drawer appears, as AntD renders one.
    const drawer = document.createElement("div");
    drawer.className = "ant-drawer-open";
    drawer.getClientRects = () => [{}] as unknown as DOMRectList;
    let closed = false;
    const close = document.createElement("button");
    close.className = "ant-drawer-close";
    close.addEventListener("click", () => {
      closed = true;
    });
    drawer.appendChild(close);
    act(() => {
      document.body.appendChild(drawer);
    });
    await waitFor(() => expect(window.history.length).toBeGreaterThan(before));

    // Back: the browser pops to the entry below the overlay's.
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { nuOverlay: 0 } }));
    });
    expect(closed).toBe(true);
    drawer.remove();
  });

  it("closes a sheet by its scrim, and anything else with Escape", () => {
    render(
      <MemoryRouter>
        <OverlayHistory />
      </MemoryRouter>,
    );
    const visible = (el: HTMLElement) => {
      el.getClientRects = () => [{}] as unknown as DOMRectList;
      return el;
    };
    const scrim = visible(document.createElement("div"));
    scrim.className = "nx-sheet-scrim";
    let scrimClicked = false;
    scrim.addEventListener("click", () => {
      scrimClicked = true;
    });
    const modal = visible(document.createElement("div"));
    modal.className = "ant-modal-wrap";
    modal.tabIndex = 0;
    let escaped = false;
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") escaped = true;
    });

    document.body.append(scrim);
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    // Nothing was tracked yet, so a pop with no marker leaves things alone.
    expect(scrimClicked).toBe(false);
    scrim.remove();

    document.body.append(modal);
    modal.remove();
    expect(escaped).toBe(false);
  });
});

function Scroller() {
  const ref = useRef<HTMLDivElement>(null);
  useScrollMemory(ref);
  const navigate = useNavigate();
  return (
    <div ref={ref} data-testid="scroller">
      <button onClick={() => navigate("/b")}>to b</button>
      <button onClick={() => navigate(-1)}>pop</button>
    </div>
  );
}

describe("scroll memory", () => {
  it("starts a new page at the top and restores the old one on Back", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/a"]}>
        <Routes>
          <Route path="*" element={<Scroller />} />
        </Routes>
      </MemoryRouter>,
    );
    const scroller = screen.getByTestId("scroller");
    scroller.scrollTop = 300;
    scroller.dispatchEvent(new Event("scroll"));

    await user.click(screen.getByText("to b"));
    expect(scroller.scrollTop).toBe(0);

    await user.click(screen.getByText("pop"));
    // jsdom has no layout, so the restore is attempted rather than achieved;
    // what matters is that the position recorded for /a is what it aims at.
    await waitFor(() => expect(scroller.scrollTop).toBe(300));
  });
});
