import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_EXPIRED_PATH,
  markSignedIn,
  recordSignInAttempt,
  resetSignInGuard,
} from "@/auth/keycloak";

/**
 * The sign-in loop guard (§34, §41).
 *
 * The behaviour it exists to stop is the worst failure this application can
 * have: a 401 triggers `login()`, Keycloak reissues a token, the API refuses
 * that token too, and the tab redirects again — forever, showing nothing. A
 * revoked session, a clock skew past the token's leeway, and a realm whose
 * audience no longer matches all produce exactly it, and all three look the
 * same from the browser. The reader's whole report is "it flashes".
 *
 * The two halves are asserted separately, because each is wrong on its own:
 * a guard that never re-authenticates makes a normally expired token into an
 * error page, and a guard that never trips is the loop.
 */
describe("re-authenticating", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    // A fresh document. The flag below is what distinguishes "one attempt
    // seen twice" from "two attempts", and it dies with the page in the
    // product — so a test that shares it across cases is testing a state no
    // browser is ever in.
    resetSignInGuard();
  });

  it("redirects the first time", () => {
    // The ordinary case, and by far the commonest: a token expired and the
    // reader should not see anything at all.
    expect(recordSignInAttempt(1_000)).toBe("redirect");
  });

  it("says nothing to a second caller in the same document", () => {
    /**
     * A page issues six requests at once; when the token has expired all six
     * ask to re-authenticate. The first redirects, and the rest must do
     * nothing — the document they would have done it in is being replaced.
     *
     * Without this the *second* caller read the stamp the first had just
     * written and declared a loop, which sent an end-to-end run to
     * `/errors/session-expired` while the product was fine.
     */
    expect(recordSignInAttempt(1_000)).toBe("redirect");
    expect(recordSignInAttempt(1_001)).toBe("already");
    expect(recordSignInAttempt(1_002)).toBe("already");
  });

  it("stops on a second attempt in a later document", () => {
    expect(recordSignInAttempt(1_000)).toBe("redirect");
    // The redirect happened and the document was replaced, which is what
    // `resetSignInGuard` stands for here.
    resetSignInGuard();
    // Back within a few seconds still unauthorised: the round trip did not
    // help, so doing it again will not either.
    expect(recordSignInAttempt(6_000)).toBe("loop");
  });

  it("redirects again once the window has passed", () => {
    expect(recordSignInAttempt(1_000)).toBe("redirect");
    resetSignInGuard();
    // Half an hour later is a second session expiring, not a loop — and
    // showing an error page for that would be a regression in the common case.
    expect(recordSignInAttempt(1_800_000)).toBe("redirect");
  });

  it("forgets the attempt once a credential has actually worked", () => {
    expect(recordSignInAttempt(1_000)).toBe("redirect");
    // `AuthProvider` calls this when `/api/me` answers, which proves the token
    // is good end to end. Without it the guard would be merely conservative:
    // any 401 in the fifteen seconds after a *successful* sign-in — a revoked
    // session, say — would show the loop page instead of re-authenticating.
    markSignedIn();
    expect(recordSignInAttempt(2_000)).toBe("redirect");
  });

  it("does nothing on the page that exists for this state", () => {
    /**
     * The page whose job is to say "your session ended" must not try to fix
     * it. Its own boot calls `/api/me`, which is refused for the same reason,
     * so re-authenticating sends the browser back to this address — and again,
     * and again. The page that exists for the state was unreachable in it,
     * and an end-to-end run found it by bouncing between two copies of the
     * same URL until it timed out.
     */
    window.history.replaceState({}, "", SESSION_EXPIRED_PATH);
    try {
      expect(recordSignInAttempt(1_000)).toBe("already");
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });

  it("survives storage being unavailable", () => {
    // Private windows and locked-down browsers throw on *access* rather than
    // returning null, so both sides are stubbed. Degrading to the old
    // unguarded behaviour is the right failure here: a redirect that might
    // loop beats an error page for everybody whose browser blocks storage.
    //
    // Stubbed on `Storage.prototype` and not on the instance: jsdom's
    // `sessionStorage` is a proxy, and a property defined on it is not the one
    // the call goes through — the first version of this test overrode nothing
    // and passed by exercising working storage.
    const throwing = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is disabled");
    });
    const alsoThrowing = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is disabled");
    });
    try {
      expect(recordSignInAttempt(1_000)).toBe("redirect");
      resetSignInGuard();
      expect(recordSignInAttempt(1_100)).toBe("redirect");
    } finally {
      throwing.mockRestore();
      alsoThrowing.mockRestore();
    }
  });
});
