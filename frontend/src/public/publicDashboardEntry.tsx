import "@fontsource-variable/inter";
import "@/styles/global.css";
import "@/styles/glass.css";

import { App as AntApp } from "antd";
import { StrictMode } from "react";
import type { Root } from "react-dom/client";

import { AppearanceProvider } from "@/theme/AppearanceProvider";

import { PublicDashboardPage } from "./PublicDashboardPage";

/** `/share/dashboards/<token>` → the token, or null for any other address. */
export function sharedDashboardToken(pathname: string): string | null {
  const match = /^\/share\/dashboards\/([A-Za-z0-9_-]{8,64})\/?$/.exec(pathname);
  return match ? match[1]! : null;
}

/** A public dashboard link (§25), mounted instead of the signed-in app. */
export function mountPublicDashboard(root: Root, token: string): void {
  root.render(
    <StrictMode>
      <AppearanceProvider>
        <AntApp>
          <PublicDashboardPage token={token} />
        </AntApp>
      </AppearanceProvider>
    </StrictMode>,
  );
}
