import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import type { Announcement } from "@/api/announcements";
import {
  AnnouncementBanner,
  interrupts,
  ranked,
} from "@/components/announcements/AnnouncementBanner";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The platform's own voice, in the shell (§17).
 *
 * `/announcements` is where notices are read; the band is where the ones that
 * cannot wait are *seen*. The rules worth asserting are the ones that decide
 * whether anybody keeps reading it:
 *
 * **Not every notice earns a band.** A release note is not an interruption. A
 * shell that announced everything would be one people learn to skip, and then
 * the maintenance notice is skipped too.
 *
 * **Dismissing writes a receipt**, server-side — so a notice dismissed on a
 * laptop is dismissed on the phone, and the author's reach count is the truth.
 *
 * **A notice that requires acknowledgement cannot be dismissed.** That is what
 * "requires" means, and the only way past it is the receipt the author is
 * waiting for.
 */

const NOTICE: Announcement = {
  id: "notice-9",
  title: "Scheduled maintenance on Sunday",
  body: "The platform will be read-only for two hours.",
  category: "MAINTENANCE",
  category_label: "Maintenance",
  severity: "WARNING",
  status: "PUBLISHED",
  is_live: true,
  is_expired: false,
  is_scheduled: false,
  is_pinned: false,
  publish_at: "2026-09-05T09:00:00Z",
  expires_at: null,
  audience_roles: [],
  requires_acknowledgement: false,
  link: null,
  author: { id: "u1", name: "Ada Administrator", initials: "AA" },
  created_at: null,
  updated_at: null,
  read_at: null,
  acknowledged_at: null,
};

function feedOf(...items: Announcement[]) {
  server.use(
    http.get("/platform/api/announcements", () =>
      HttpResponse.json({
        items,
        total: items.length,
        page: 1,
        page_size: 25,
        pages: 1,
        categories: [],
        unread: items.length,
        can_manage: false,
        category: "",
        include_expired: false,
      }),
    ),
  );
}

function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname}</span>;
}

function render() {
  return renderWithProviders(
    <>
      <Address />
      <AnnouncementBanner />
      <Routes>
        <Route path="/" element={<div>the page</div>} />
        <Route path="/announcements" element={<div>the noticeboard</div>} />
        <Route path="/settings/system" element={<div>the system page</div>} />
      </Routes>
    </>,
  );
}

describe("which notices interrupt", () => {
  it("lets a pinned or louder-than-news notice through, and nothing else", () => {
    expect(interrupts(NOTICE)).toBe(true);
    expect(interrupts({ ...NOTICE, severity: "CRITICAL" })).toBe(true);
    expect(interrupts({ ...NOTICE, severity: "INFO", is_pinned: true })).toBe(true);
    // A release note belongs on the page and in the count beside the menu
    // item, not across the top of every screen.
    expect(interrupts({ ...NOTICE, severity: "INFO", category: "RELEASE" })).toBe(false);
  });

  it("lets nothing through that this reader has already read", () => {
    expect(interrupts({ ...NOTICE, read_at: "2026-09-06T08:00:00Z" })).toBe(false);
  });

  it("keeps an unacknowledged notice even when it has been read", () => {
    // Reading is not agreeing, and the author is waiting for the second one.
    expect(
      interrupts({
        ...NOTICE,
        severity: "INFO",
        requires_acknowledgement: true,
        read_at: null,
      }),
    ).toBe(true);
  });

  it("puts the one that has to be agreed to first, then pinned, then severity", () => {
    const order = ranked([
      { ...NOTICE, id: "info", severity: "INFO" },
      { ...NOTICE, id: "critical", severity: "CRITICAL" },
      { ...NOTICE, id: "agree", severity: "INFO", requires_acknowledgement: true },
      { ...NOTICE, id: "pinned", severity: "INFO", is_pinned: true },
    ]).map((notice) => notice.id);

    expect(order).toEqual(["agree", "pinned", "critical", "info"]);
  });
});

describe("the band", () => {
  it("says nothing when there is nothing to say", async () => {
    feedOf();
    render();

    await screen.findByText("the page");
    expect(screen.queryByTestId("announcement-banner")).not.toBeInTheDocument();
  });

  it("shows the notice, and dismissing it writes a receipt", async () => {
    const receipts: Array<{ id: string; acknowledged: boolean }> = [];
    feedOf(NOTICE);
    server.use(
      http.post("/platform/api/announcements/:id/receipt", async ({ params, request }) => {
        const body = (await request.json()) as { acknowledged?: boolean };
        receipts.push({ id: String(params["id"]), acknowledged: Boolean(body.acknowledged) });
        return HttpResponse.json({ ...NOTICE, read_at: "2026-09-09T09:00:00Z" });
      }),
    );
    const user = userEvent.setup();
    render();

    const band = await screen.findByTestId("announcement-banner");
    expect(band).toHaveTextContent("Scheduled maintenance on Sunday");
    await user.click(within(band).getByTestId("announcement-dismiss"));

    // The server is told, rather than a flag being kept in this browser.
    await waitFor(() => expect(receipts).toEqual([{ id: "notice-9", acknowledged: false }]));
  });

  it("offers acknowledgement instead of dismissal when the notice asks for it", async () => {
    const receipts: Array<{ acknowledged: boolean }> = [];
    feedOf({ ...NOTICE, requires_acknowledgement: true, severity: "CRITICAL" });
    server.use(
      http.post("/platform/api/announcements/:id/receipt", async ({ request }) => {
        const body = (await request.json()) as { acknowledged?: boolean };
        receipts.push({ acknowledged: Boolean(body.acknowledged) });
        return HttpResponse.json({ ...NOTICE, acknowledged_at: "2026-09-09T09:00:00Z" });
      }),
    );
    const user = userEvent.setup();
    render();

    const band = await screen.findByTestId("announcement-banner");
    // No way past it but through it.
    expect(within(band).queryByTestId("announcement-dismiss")).not.toBeInTheDocument();
    await user.click(within(band).getByTestId("announcement-acknowledge"));

    await waitFor(() => expect(receipts).toEqual([{ acknowledged: true }]));
  });

  it("shows one band and counts the rest", async () => {
    feedOf(
      { ...NOTICE, id: "a", severity: "CRITICAL", title: "Incident in progress" },
      { ...NOTICE, id: "b", title: "Maintenance on Sunday" },
      { ...NOTICE, id: "c", title: "Another window" },
    );
    const user = userEvent.setup();
    render();

    const band = await screen.findByTestId("announcement-banner");
    // Loudest first, and two bands stacked would be a page that has lost its
    // header.
    expect(band).toHaveTextContent("Incident in progress");
    expect(screen.getAllByTestId("announcement-banner")).toHaveLength(1);

    await user.click(within(band).getByText("2 more notices"));
    expect(await screen.findByText("the noticeboard")).toBeInTheDocument();
  });

  it("offers the notice's own link when it has one", async () => {
    feedOf({ ...NOTICE, link: "/settings/system" });
    const user = userEvent.setup();
    render();

    const band = await screen.findByTestId("announcement-banner");
    await user.click(within(band).getByText("Open"));

    // A notice you cannot act on is noise (§66).
    expect(await screen.findByText("the system page")).toBeInTheDocument();
  });
});
