/**
 * The render helper every component test uses.
 *
 * Wraps the tree in the same providers `main.tsx` does, so a test exercises the
 * component in the context it actually runs in — theme included. A component
 * tested outside its providers is a component tested in a situation that never
 * occurs.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { AppearanceProvider } from "@/theme/AppearanceProvider";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // No retries in tests: a deliberate 500 should fail once and be asserted,
      // not retried until the test times out.
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      <AppearanceProvider>
        <AntApp>{children}</AntApp>
      </AppearanceProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  return render(ui, { wrapper: Providers, ...options });
}
