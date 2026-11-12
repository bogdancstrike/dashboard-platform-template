import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The adapter's wiring, with keycloak-js replaced by a recording fake.
 *
 * `keycloak.test.ts` covers the loop guard on its own; this covers what the
 * guard is wired into — the token provider every request asks, the expiry
 * hook, and the two ways out (sign out, sign in again). The module holds its
 * adapter in a variable, so each test imports a fresh copy of it.
 */

interface FakeKeycloak {
  config: unknown;
  token?: string;
  init: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  updateToken: ReturnType<typeof vi.fn>;
  onTokenExpired?: () => void;
}

const created: FakeKeycloak[] = [];
let authenticated = true;

// A class rather than `vi.fn().mockImplementation`: the suite runs with
// `restoreMocks`, which would strip the implementation after the first test.
vi.mock("keycloak-js", () => ({
  default: class {
    constructor(config: unknown) {
      const instance: FakeKeycloak = {
        config,
        token: "access-1",
        init: vi.fn(() => Promise.resolve(authenticated)),
        login: vi.fn(() => Promise.resolve()),
        logout: vi.fn(() => Promise.resolve()),
        updateToken: vi.fn(() => Promise.resolve(true)),
      };
      created.push(instance);
      return instance;
    }
  },
}));

const meta = {
  auth: { url: "http://idp.example", realm: "nucleus", client_id: "web" },
} as unknown as import("@/api/meta").AppMeta;

async function freshModules() {
  vi.resetModules();
  const client = await import("@/api/client");
  const adapter = await import("./keycloak");
  return { client, adapter };
}

const assign = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  created.length = 0;
  authenticated = true;
  window.sessionStorage.clear();
  assign.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...realLocation,
      assign,
      href: "http://localhost/admin/tags?x=1",
      origin: "http://localhost",
      pathname: "/admin/tags",
      search: "?x=1",
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

describe("initialising the adapter", () => {
  it("configures keycloak from the published metadata and hands out its token", async () => {
    const { client, adapter } = await freshModules();
    await adapter.initializeAuth(meta);
    expect(created).toHaveLength(1);
    expect(created[0]!.config).toEqual({
      url: "http://idp.example",
      realm: "nucleus",
      clientId: "web",
    });
    expect(created[0]!.init).toHaveBeenCalledWith(
      expect.objectContaining({ onLoad: "login-required", pkceMethod: "S256" }),
    );
    // Refreshed before it is handed out, so a request never carries a stale one.
    expect(await client.accessToken()).toBe("access-1");
    expect(created[0]!.updateToken).toHaveBeenCalledWith(30);

    // A second initialisation is a no-op rather than a second adapter.
    await adapter.initializeAuth(meta);
    expect(created).toHaveLength(1);
  });

  it("sends an unauthenticated browser to sign in", async () => {
    authenticated = false;
    const { adapter } = await freshModules();
    await adapter.initializeAuth(meta);
    expect(created[0]!.login).toHaveBeenCalledWith({
      redirectUri: "http://localhost/admin/tags?x=1",
    });
  });

  it("re-authenticates when a token cannot be refreshed", async () => {
    const { client, adapter } = await freshModules();
    await adapter.initializeAuth(meta);
    const kc = created[0]!;
    kc.updateToken.mockRejectedValueOnce(new Error("refresh token expired"));
    expect(await client.accessToken()).toBeNull();
    expect(kc.login).toHaveBeenCalledTimes(1);
  });

  it("refreshes on expiry and falls back to signing in", async () => {
    const { adapter } = await freshModules();
    await adapter.initializeAuth(meta);
    const kc = created[0]!;
    kc.updateToken.mockRejectedValueOnce(new Error("gone"));
    kc.onTokenExpired?.();
    await vi.waitFor(() => expect(kc.login).toHaveBeenCalled());
  });

  it("stops a sign-in loop on the session-expired page, remembering where the reader was", async () => {
    const { client, adapter } = await freshModules();
    await adapter.initializeAuth(meta);
    // A sign-in moments ago, from a previous document.
    window.sessionStorage.setItem("nu.auth.last-sign-in", String(Date.now()));
    const kc = created[0]!;
    kc.updateToken.mockRejectedValueOnce(new Error("refused"));
    await client.accessToken();
    expect(kc.login).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith(adapter.SESSION_EXPIRED_PATH);
    expect(window.sessionStorage.getItem("nu.auth.wanted")).toBe("/admin/tags?x=1");

    // Signing in again ends the SSO session and comes back to that page.
    await adapter.signInAgain();
    expect(kc.logout).toHaveBeenCalledWith({ redirectUri: "http://localhost/admin/tags?x=1" });
  });
});

describe("leaving", () => {
  it("signs out to the origin", async () => {
    const { adapter } = await freshModules();
    await adapter.initializeAuth(meta);
    await adapter.signOut();
    expect(created[0]!.logout).toHaveBeenCalledWith({ redirectUri: "http://localhost" });
  });

  it("cannot sign out before the adapter exists", async () => {
    const { adapter } = await freshModules();
    expect(() => adapter.signOut()).toThrow(/not been initialized/);
  });

  it("reloads at boot, when there is no session to escape", async () => {
    const { adapter } = await freshModules();
    await adapter.signInAgain();
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("never follows a stored absolute URL back after signing in", async () => {
    const { adapter } = await freshModules();
    await adapter.initializeAuth(meta);
    window.sessionStorage.setItem("nu.auth.wanted", "//evil.example/steal");
    await adapter.signInAgain();
    expect(created[0]!.logout).toHaveBeenCalledWith({ redirectUri: "http://localhost/" });
  });
});
