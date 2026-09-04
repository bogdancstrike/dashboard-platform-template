import "@fontsource-variable/inter";
import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, Button, Result, Spin } from "antd";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { ApiError } from "@/api/client";
import { metaApi } from "@/api/meta";
import { asText } from "@/lib/text";
import { AuthProvider } from "@/auth/AuthProvider";
import { initializeAuth } from "@/auth/keycloak";
import { CommandProvider } from "@/commands/CommandContext";
import App from "@/App";
import { AppearanceProvider } from "@/theme/AppearanceProvider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A list page is read far more often than it changes, and refetching on
      // every window focus makes a table the user is reading jump under them.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Retrying a 403 will not make the caller more authorised, and
        // retrying a 404 will not make the record exist. Only transient
        // failures are worth a second attempt.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

const root = createRoot(container);

function Boot({ error }: { error?: unknown }) {
  if (error) {
    return (
      <div className="nu-boot">
        <Result
          status="error"
          title="Could not sign you in"
          subTitle={error instanceof Error ? error.message : asText(error)}
          extra={<Button onClick={() => window.location.reload()}>Try again</Button>}
        />
      </div>
    );
  }
  return (
    <div className="nu-boot" role="status" aria-live="polite">
      <Spin size="large" />
      <span>Signing you in…</span>
    </div>
  );
}

root.render(<Boot />);

async function start() {
  const meta = await metaApi.app();
  await initializeAuth(meta);
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppearanceProvider>
          {/* AntApp supplies the message/notification/modal contexts that the
              static `message.*` helpers cannot theme. */}
          <AntApp>
            <AuthProvider>
              <BrowserRouter>
                <CommandProvider>
                  <App />
                </CommandProvider>
              </BrowserRouter>
            </AuthProvider>
          </AntApp>
        </AppearanceProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start().catch((error: unknown) => root.render(<Boot error={error} />));
