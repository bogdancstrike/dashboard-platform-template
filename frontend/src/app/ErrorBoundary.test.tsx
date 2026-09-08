import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";

import { ErrorBoundary } from "@/app/ErrorBoundary";

/**
 * The boundary between one broken component and a white page (§34).
 *
 * React logs every caught error to the console itself, so the console is
 * silenced here — otherwise the suite's output is three stack traces per test
 * and a reader stops reading it.
 *
 * The claims:
 *
 * **A throw becomes a page, not a blank tab.** The failure this replaced left
 * nothing on screen at all, which is the one failure a reader cannot report.
 *
 * **Navigating away clears it.** The shell survives the fault, so the sidebar
 * still works — and a boundary that latched would leave somebody stuck on a
 * page they had already left.
 *
 * **Try again actually recovers.** A component that throws while *updating*
 * holds the state that broke it, so this is the case where a retry could
 * plausibly do nothing — it works because React unmounts everything below a
 * boundary that catches, which is a fact this test is here to hold true.
 */

function Bomb({ live }: { live: boolean }) {
  if (live) throw new Error("the component exploded");
  return <div>the page</div>;
}

/**
 * Works, then breaks on an update — which is what the remount is for.
 *
 * A component that throws while *updating* keeps the state that broke it. Ask
 * the same instance to render again and it throws again, so a retry that only
 * re-renders is a button that visibly does nothing. A fresh instance starts
 * from a state that worked.
 */
function BreaksOnUpdate() {
  const [broken, setBroken] = useState(false);
  if (broken) throw new Error("broke while updating");
  return <button onClick={() => setBroken(true)}>break it</button>;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a component that throws", () => {
  it("becomes a page that says what happened", () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Bomb live />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("problem-server")).toBeInTheDocument();
    expect(screen.getByText(/failed while it was being drawn/)).toBeInTheDocument();
    // And a way forward, which the white page did not have.
    expect(screen.getByTestId("problem-retry")).toBeInTheDocument();
  });

  it("does not stand between a working page and its reader", () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Bomb live={false} />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText("the page")).toBeInTheDocument();
    expect(screen.queryByTestId("problem-server")).not.toBeInTheDocument();
  });

  it("still logs the fault, so it is not merely hidden", () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Bomb live />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    // A boundary that swallows the stack makes every one of these harder to
    // fix than the blank page it replaced.
    expect(console.error).toHaveBeenCalledWith(
      "A page failed while rendering.",
      expect.objectContaining({ message: "the component exploded" }),
      expect.anything(),
    );
  });
});

describe("getting out again", () => {
  it("clears the fault when the location changes", () => {
    const { rerender } = render(
      <MemoryRouter>
        <ErrorBoundary resetKey="/broken">
          <Bomb live />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("problem-server")).toBeInTheDocument();

    // The shell is still mounted, so the reader clicked a different page.
    // That has to show the page.
    rerender(
      <MemoryRouter>
        <ErrorBoundary resetKey="/somewhere-else">
          <Bomb live={false} />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText("the page")).toBeInTheDocument();
    expect(screen.queryByTestId("problem-server")).not.toBeInTheDocument();
  });

  it("recovers on a retry, with none of the state that broke it", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <BreaksOnUpdate />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "break it" }));
    expect(screen.getByTestId("problem-server")).toBeInTheDocument();

    await user.click(screen.getByTestId("problem-retry"));
    // A fresh instance: React unmounted the subtree when it caught, so the
    // `broken` state is gone. Were it reused, this would throw again on the
    // first render and the button would visibly do nothing.
    expect(screen.getByRole("button", { name: "break it" })).toBeInTheDocument();
    expect(screen.queryByTestId("problem-server")).not.toBeInTheDocument();
  });
});
