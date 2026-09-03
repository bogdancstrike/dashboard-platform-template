/**
 * Build-time constants.
 *
 * Deliberately almost empty. Everything that varies per deployment — the
 * Keycloak realm, its public URL, the SPA client id, the feature toggles — is
 * fetched from `/platform/meta/app` at startup instead of being baked in here.
 *
 * That is what lets one built image run in staging and production: an
 * environment variable compiled into a bundle is a bundle you have to rebuild
 * to move, and a Keycloak URL compiled into a bundle is one that is wrong the
 * first time somebody puts the app behind a different hostname.
 */

/** Matches `Config.API_PREFIX` on the backend and the `platform` namespace. */
export const API_PREFIX = "/platform";

export const CORRELATION_HEADER = "X-Correlation-ID";

/** localStorage keys. Namespaced so two apps on one origin cannot collide. */
export const STORAGE_KEYS = {
  appearance: "nucleus.appearance",
  density: "nucleus.density",
  sidebarCollapsed: "nucleus.sidebar.collapsed",
} as const;
