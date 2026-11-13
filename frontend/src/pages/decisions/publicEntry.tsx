import "@fontsource-variable/inter";
import "@/styles/global.css";
import "@/styles/glass.css";

import { App as AntApp } from "antd";
import { StrictMode } from "react";
import type { Root } from "react-dom/client";

import { AppearanceProvider } from "@/theme/AppearanceProvider";

import { PublicFormPage } from "./PublicFormPage";

/** `/f/<slug>`, outside the signed-in application. */
export function publicFormSlug(pathname: string): string | null {
  const match = /^\/f\/([a-z0-9][a-z0-9-]{1,78}[a-z0-9])\/?$/.exec(pathname);
  return match ? match[1]! : null;
}

export function mountPublicForm(root: Root, slug: string): void {
  root.render(
    <StrictMode>
      <AppearanceProvider>
        <AntApp>
          <PublicFormPage slug={slug} />
        </AntApp>
      </AppearanceProvider>
    </StrictMode>,
  );
}
