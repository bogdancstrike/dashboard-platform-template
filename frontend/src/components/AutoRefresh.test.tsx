import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutoRefresh } from "@/components/AutoRefresh";
import { refreshLabel, storedInterval } from "@/hooks/useAutoRefresh";
import { renderWithProviders } from "@/test/render";

/**
 * A refresh the reader turns on, per page (§53).
 *
 * What is worth asserting is not that a timer fires — it is the four
 * decisions around it, each of which is the difference between a useful
 * control and one people switch off:
 *
 * * it is **off by default** on an ordinary page, and a console may open with
 *   an interval already running;
 * * the choice is **remembered per page**, so watching the job queue every
 *   thirty seconds says nothing about the account list;
 * * it is **parked while the tab is hidden**, and refreshes once on return;
 * * and the button itself refreshes, because "just reload it" should not be
 *   two clicks.
 */

function render(props: Partial<Parameters<typeof AutoRefresh>[0]> = {}) {
  const refresh = vi.fn();
  renderWithProviders(<AutoRefresh page="probe" refresh={refresh} {...props} />);
  return { refresh };
}

/** The tab, as far as the browser API is concerned. */
function hide(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  hide(false);
  window.localStorage.clear();
});

describe("how often a page re-asks", () => {
  it("is off until somebody says otherwise", () => {
    const { refresh } = render();

    expect(screen.getByTestId("refresh-now")).toHaveTextContent("Refresh");
    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });
    // Ten minutes of nothing: a page that polls on a timer nobody asked for
    // spends the database's time on a tab somebody left open.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes now when the button is pressed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { refresh } = render();

    await user.click(screen.getByTestId("refresh-now"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("fires on the interval once one is chosen, and remembers it for this page", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { refresh } = render();

    // The arrow, not the main button: the split is the point of the control.
    await user.click(screen.getByRole("button", { name: /down/ }));
    await user.click(await screen.findByText("Every 30s"));

    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);

    // Remembered under this page's own key: another page reads its own.
    expect(storedInterval("probe")).toBe(30);
    expect(storedInterval("another-page")).toBe(0);
  });

  it("lets a console open with an interval already running", () => {
    const { refresh } = render({ defaultSeconds: 30 });

    expect(screen.getByTestId("refresh-now")).toHaveTextContent("30s");
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("prefers what the reader chose over the page's default", () => {
    window.localStorage.setItem("nucleus.refresh.probe", "0");
    const { refresh } = render({ defaultSeconds: 30 });

    // Turning it *off* on a page that defaults to on has to stick, or the
    // control is a suggestion.
    expect(screen.getByTestId("refresh-now")).toHaveTextContent("Refresh");
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("parks while the tab is hidden, and catches up once on return", () => {
    const { refresh } = render({ defaultSeconds: 30 });

    hide(true);
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });
    // Nothing while nobody is looking: the same waste, with no reader.
    expect(refresh).not.toHaveBeenCalled();

    hide(false);
    // Once, not once per skipped tick — coming back to a stale page is when a
    // refresh is worth doing, and ten of them are not ten times as useful.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says how old what is on screen is, not when the request went out", () => {
    render({ updatedAt: Date.now() - 4 * 60 * 1000 });

    expect(screen.getByTestId("refreshed-at")).toHaveTextContent("Refreshed 4m ago");
  });

  it("says it is refreshing while it is", () => {
    render({ updatedAt: Date.now(), busy: true });

    expect(screen.getByTestId("refreshed-at")).toHaveTextContent("Refreshing…");
  });
});

describe("how an interval reads", () => {
  it("is words a person would use", () => {
    // "Off" rather than "0 s", and "5m" rather than "300s".
    expect(refreshLabel(0)).toBe("Off");
    expect(refreshLabel(30)).toBe("30s");
    expect(refreshLabel(60)).toBe("1m");
    expect(refreshLabel(300)).toBe("5m");
  });
});
