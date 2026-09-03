/** Runtime-configured Keycloak adapter.
 *
 * Nothing deployment-specific is compiled into the bundle. The adapter is
 * created only after `/meta/app` publishes the realm's public URL and client
 * id, then every API request asks it for a fresh-enough token.
 */

import Keycloak from "keycloak-js";

import { setTokenProvider, setUnauthorizedHandler } from "@/api/client";
import type { AppMeta } from "@/api/meta";

let keycloak: Keycloak | null = null;

export async function initializeAuth(meta: AppMeta): Promise<void> {
  if (keycloak) return;

  const client = new Keycloak({
    url: meta.auth.url,
    realm: meta.auth.realm,
    clientId: meta.auth.client_id,
  });
  const authenticated = await client.init({
    onLoad: "login-required",
    pkceMethod: "S256",
    checkLoginIframe: false,
  });

  if (!authenticated) {
    await client.login({ redirectUri: window.location.href });
    return;
  }

  keycloak = client;

  setTokenProvider(async () => {
    const active = requireClient();
    try {
      await active.updateToken(30);
    } catch {
      await active.login({ redirectUri: window.location.href });
      return null;
    }
    return active.token ?? null;
  });

  setUnauthorizedHandler(() => {
    void requireClient().login({ redirectUri: window.location.href });
  });

  // Refresh immediately on expiry as well as lazily before requests. This
  // keeps WebSocket reconnects and long-idle tabs from holding a stale token.
  client.onTokenExpired = () => {
    void client.updateToken(30).catch(() => client.login({ redirectUri: window.location.href }));
  };
}

export function signOut(): Promise<void> {
  return requireClient().logout({ redirectUri: window.location.origin });
}

export function switchPersona(username: string): Promise<void> {
  return requireClient().login({
    prompt: "login",
    loginHint: username,
    redirectUri: `${window.location.origin}/dashboard`,
  });
}

function requireClient(): Keycloak {
  if (!keycloak) throw new Error("Authentication has not been initialized.");
  return keycloak;
}
