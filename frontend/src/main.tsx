import "@fontsource-variable/inter";
import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { ApiError } from "@/api/client";
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

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
        {/* AntApp supplies the message/notification/modal contexts that the
            static `message.*` helpers cannot theme. */}
        <AntApp>
          <BrowserRouter>
            <CommandProvider>
              <App />
            </CommandProvider>
          </BrowserRouter>
        </AntApp>
      </AppearanceProvider>
    </QueryClientProvider>
  </StrictMode>,
);
