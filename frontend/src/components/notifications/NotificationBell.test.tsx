import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { NotificationBell } from "@/components/notifications/NotificationBell";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

describe("the header notification bell", () => {
  it("shows the unread count and says so to a screen reader", async () => {
    renderWithProviders(<NotificationBell />);

    const trigger = await screen.findByRole("button", { name: "Notifications, 2 unread" });
    expect(trigger).toBeInTheDocument();
  });

  it("does not fetch the list until it is opened", async () => {
    const user = userEvent.setup();
    let listCalls = 0;
    server.use(
      http.get("/platform/notifications", ({ request }) => {
        listCalls += 1;
        return HttpResponse.json({
          items: [],
          total: 0,
          page: 1,
          page_size: 6,
          pages: 1,
          sort: "created_at",
          order: "desc",
          grouped: false,
          unread: 0,
          by_category: {},
          _url: request.url,
        });
      }),
    );

    renderWithProviders(<NotificationBell />);
    await screen.findByRole("button", { name: /Notifications/ });
    // Closed, the panel is not something anybody is reading.
    expect(listCalls).toBe(0);

    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    await waitFor(() => expect(listCalls).toBe(1));
  });

  it("lists the newest few and marks them all read", async () => {
    const user = userEvent.setup();
    let marked = false;
    server.use(
      http.post("/platform/notifications/read-all", () => {
        marked = true;
        return HttpResponse.json({ marked: 2, read_at: "2026-09-03T12:00:00Z" });
      }),
    );

    renderWithProviders(<NotificationBell />);
    await user.click(await screen.findByRole("button", { name: /Notifications/ }));

    expect(
      await screen.findByText("Mara Manager assigned you TSK-00042"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Mark all read/ }));
    await waitFor(() => expect(marked).toBe(true));
  });

  it("offers a way through to the full centre", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationBell />);

    await user.click(await screen.findByRole("button", { name: /Notifications/ }));

    expect(
      await screen.findByRole("button", { name: "Open the notification centre" }),
    ).toBeInTheDocument();
  });
});
