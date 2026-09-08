import { Component, type ErrorInfo, type ReactNode } from "react";

import { lastFailedCorrelationId } from "@/api/client";
import { ProblemPage } from "@/components/ProblemPage";

/**
 * What stands between one component throwing and a white page (§34).
 *
 * Until this existed, a render fault anywhere below the shell unmounted the
 * whole application: no header, no navigation, no message — a blank tab, from
 * which the only recovery is knowing to reload. That is the worst failure mode
 * in the product, because it is the one that tells the reader nothing at all
 * and leaves them no way to report it.
 *
 * A class, and not because of taste: `componentDidCatch` has no hook
 * equivalent, and React Router's `errorElement` belongs to the data routers
 * this application does not use.
 *
 * Two decisions worth keeping:
 *
 * **It resets on navigation.** A boundary that latches would leave a reader
 * stuck on the fault after they had already walked away from it — the shell is
 * still mounted, so the sidebar works, and clicking a different page must show
 * that page. The `resetKey` is the location, supplied by the caller.
 *
 * **It reports a reference, not a stack.** A stack trace on screen is for the
 * person who wrote the code and is standing there; the correlation id is for
 * everybody else, and it is what makes the failure findable in the logs. The
 * stack goes to the console, where a developer will look for it anyway.
 */
interface Props {
  children: ReactNode;
  /**
   * Changing this clears a caught fault. Pass the current location, so that
   * navigating away from a broken page is enough to leave it.
   */
  resetKey?: string;
}

interface State {
  failed: boolean;
  /** The reference shown to the reader, captured when the fault happened. */
  reference: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, reference: null };

  static getDerivedStateFromError(): Partial<State> {
    // The reference is read here rather than in `componentDidCatch` because
    // this runs first, and a request that fails *while the fault is being
    // handled* would otherwise overwrite the id belonging to the fault.
    return { failed: true, reference: lastFailedCorrelationId() };
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false, reference: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept out of the reader's way but not swallowed: a boundary that hides
    // the stack from the console has made every one of these harder to fix
    // than the white page it replaced.
    console.error("A page failed while rendering.", error, info.componentStack);
  }

  /**
   * Ask for the page again.
   *
   * Clearing the flag is the whole of it, and that is worth knowing rather
   * than assuming: React unmounts everything below a boundary that catches, so
   * what renders next is a *new* subtree with none of the state that broke.
   * An earlier version keyed the children on an attempt counter to force
   * exactly that, and a test proved the key changed nothing — React had
   * already done it. Verified rather than believed, and then deleted.
   */
  private retry = (): void => {
    this.setState({ failed: false, reference: null });
  };

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <ProblemPage
          kind="server"
          correlationId={this.state.reference ?? undefined}
          onRetry={this.retry}
        />
      );
    }
    // No wrapper element: `#nu-main` is a flex column and every page is one of
    // its items, so a `div` here would make the whole application one item
    // tall.
    return this.props.children;
  }
}
