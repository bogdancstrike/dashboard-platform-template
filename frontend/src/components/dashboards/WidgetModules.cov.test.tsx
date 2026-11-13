import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { DashboardWidget } from "@/api/dashboards";
import { explorerCatalogue } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import {
  AnnouncementsBody,
  CalendarBody,
  ExplorerBody,
  FavoritesBody,
  FilesBody,
  MailBody,
  NotificationsBody,
  ProjectsBody,
  RelationshipsBody,
  TasksBody,
  type ModuleBodyProps,
} from "./widgets/modules";

/**
 * The module widgets (§45): a window onto a page, answered by that page's own
 * endpoint.
 *
 * Each is checked three ways — what it draws from an answer, what it says
 * when the answer is empty, and that a refusal reaches the fallback the grid
 * passes in rather than throwing — by the links and words a reader sees.
 */

const resources = explorerCatalogue.items;

function widget(kind: string, config: Record<string, unknown> = {}): DashboardWidget {
  return {
    id: `w-${kind}`,
    kind: kind as DashboardWidget["kind"],
    title: kind,
    subtitle: null,
    x: 0,
    y: 0,
    width: 4,
    height: 3,
    position: 0,
    config: config,
  };
}

const fallback: ModuleBodyProps["fallback"] = (_error, subject) => (
  <div role="alert">could not read {subject}</div>
);

function draw(Body: (props: ModuleBodyProps) => JSX.Element, kind: string, config = {}) {
  return renderWithProviders(<Body widget={widget(kind, config)} resources={resources} fallback={fallback} />);
}

const refused = () => HttpResponse.json({ error: "forbidden", message: "no" }, { status: 403 });

const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
const today = new Date().toISOString().slice(0, 10);

describe("tasks", () => {
  it("draws the status lanes and the latest work items", async () => {
    server.use(
      http.post("/platform/api/explorer/query", () =>
        HttpResponse.json({
          items: [
            { id: "t1", title: "Ship it", status: "IN_PROGRESS", progress: 40 },
            { id: "t2", title: "Plan it", status: "TODO", progress: 0 },
          ],
          total: 42,
          facets: { status: [{ value: "IN_PROGRESS", count: 30 }, { value: "TODO", count: 12 }, { value: "DONE", count: 0 }] },
        }),
      ),
    );
    draw(TasksBody, "TASKS", { status: "IN_PROGRESS" });
    expect(await screen.findByRole("link", { name: /Ship it/ })).toHaveAttribute("href", "/tasks/t1");
    expect(screen.getByRole("link", { name: /30\s*IN PROGRESS/ })).toHaveAttribute(
      "href",
      "/tasks?f.status=IN_PROGRESS",
    );
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All 42 tasks" })).toBeInTheDocument();
  });

  it("draws one board's own lanes when it names a board", async () => {
    server.use(
      http.get("/platform/api/kanban/boards/:id", () =>
        HttpResponse.json({
          board: { id: "b1", name: "Ops" },
          lanes: [
            { id: "l1", name: "Doing", total: 7, wip_limit: 5, over_limit: true },
            { id: "l2", name: "Done", total: 3, wip_limit: null, over_limit: false },
          ],
        }),
      ),
    );
    draw(TasksBody, "TASKS", { board_id: "b1" });
    expect(await screen.findByText("of 5")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Ops" })).toHaveAttribute("href", "/kanban?board=b1");
  });

  it("says so when a board has no lanes, or nothing matches", async () => {
    server.use(
      http.get("/platform/api/kanban/boards/:id", () => HttpResponse.json({ board: { id: "b", name: "B" }, lanes: [] })),
      http.post("/platform/api/explorer/query", () => HttpResponse.json({ items: [], total: 0, facets: {} })),
    );
    draw(TasksBody, "TASKS", { board_id: "b" });
    expect(await screen.findByText("This board has no lanes yet")).toBeInTheDocument();
    draw(TasksBody, "TASKS");
    expect(await screen.findByText("No work items match")).toBeInTheDocument();
  });

  it("hands a refusal to the fallback", async () => {
    server.use(http.get("/platform/api/kanban/boards/:id", refused), http.post("/platform/api/explorer/query", refused));
    draw(TasksBody, "TASKS", { board_id: "b" });
    expect(await screen.findByText("could not read this board")).toBeInTheDocument();
    draw(TasksBody, "TASKS");
    expect(await screen.findByText("could not read task")).toBeInTheDocument();
  });
});

describe("projects", () => {
  it("draws each project's progress", async () => {
    server.use(
      http.post("/platform/api/explorer/query", () =>
        HttpResponse.json({ items: [{ id: "p1", name: "Atlas", status: "ACTIVE", progress: 62.4 }], total: 9, facets: {} }),
      ),
    );
    draw(ProjectsBody, "PROJECTS", { status: "ACTIVE" });
    expect(await screen.findByLabelText("Atlas: 62% complete")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All 9 projects" })).toBeInTheDocument();
  });

  it("says when none match, and falls back on a refusal", async () => {
    server.use(http.post("/platform/api/explorer/query", () => HttpResponse.json({ items: [], total: 0, facets: {} })));
    draw(ProjectsBody, "PROJECTS");
    expect(await screen.findByText("No projects match")).toBeInTheDocument();
    server.use(http.post("/platform/api/explorer/query", refused));
    draw(ProjectsBody, "PROJECTS");
    expect(await screen.findByText("could not read project")).toBeInTheDocument();
  });
});

describe("mail", () => {
  it("lists threads, marking unread, starred and attached", async () => {
    server.use(
      http.get("/platform/api/mail/threads", () =>
        HttpResponse.json({
          items: [
            {
              id: "m1",
              subject: "Quarterly numbers",
              participants: [{ name: "Ana Analyst", email: "ana@x" }],
              unread_count: 1,
              message_count: 3,
              is_starred: true,
              has_attachments: true,
              last_message_at: soon,
            },
            { id: "m2", subject: "", participants: [], unread_count: 0, message_count: 1, is_starred: false, has_attachments: false, last_message_at: null },
          ],
          folders: [{ key: "INBOX", unread: 4 }],
        }),
      ),
    );
    draw(MailBody, "MAIL", { unread_only: true });
    expect(await screen.findByText("Quarterly numbers")).toBeInTheDocument();
    expect(screen.getByText("(no subject)")).toBeInTheDocument();
    expect(screen.getByLabelText("Starred")).toBeInTheDocument();
    expect(screen.getByLabelText("Has an attachment")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "4 unread in inbox" })).toHaveAttribute("href", "/mail?folder=INBOX");
  });

  it("says when a folder is empty, and falls back on a refusal", async () => {
    server.use(http.get("/platform/api/mail/threads", () => HttpResponse.json({ items: [], folders: [] })));
    draw(MailBody, "MAIL", { unread_only: true });
    expect(await screen.findByText("Nothing unread")).toBeInTheDocument();
    draw(MailBody, "MAIL", { folder: "SENT" });
    expect(await screen.findByText("Nothing in this folder")).toBeInTheDocument();
    server.use(http.get("/platform/api/mail/threads", refused));
    draw(MailBody, "MAIL");
    expect(await screen.findByText("could not read mail")).toBeInTheDocument();
  });
});

describe("files", () => {
  it("lists files with a readable size", async () => {
    server.use(
      http.get("/platform/api/files", () =>
        HttpResponse.json({
          items: [
            { id: "f1", name: "plan.pdf", size_bytes: 1536 },
            { id: "f2", name: "tiny.txt", size_bytes: 12 },
            { id: "f3", name: "empty.txt", size_bytes: 0 },
            { id: "f4", name: "video.mp4", size_bytes: 50 * 1024 * 1024 },
          ],
          total: 4,
        }),
      ),
    );
    draw(FilesBody, "FILES", { folder_id: "folder-1" });
    expect(await screen.findByText("plan.pdf")).toBeInTheDocument();
    expect(screen.getByText("1.5 KB")).toBeInTheDocument();
    expect(screen.getByText("12 B")).toBeInTheDocument();
    expect(screen.getByText("50 MB")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("says when there are none, and falls back on a refusal", async () => {
    server.use(http.get("/platform/api/files", () => HttpResponse.json({ items: [], total: 0 })));
    draw(FilesBody, "FILES");
    expect(await screen.findByText("No files here yet")).toBeInTheDocument();
    server.use(http.get("/platform/api/files", refused));
    draw(FilesBody, "FILES");
    expect(await screen.findByText("could not read files")).toBeInTheDocument();
  });
});

describe("notifications", () => {
  it("lists them by severity, linking where each points", async () => {
    server.use(
      http.get("/platform/notifications", () =>
        HttpResponse.json({
          items: [
            { id: "n1", title: "Disk nearly full", severity: "WARNING", is_read: false, link: "/admin/health", created_at: soon },
            { id: "n2", title: "Welcome", severity: "INFO", is_read: true, link: null, created_at: soon },
          ],
          total: 2,
          unread: 1,
        }),
      ),
    );
    draw(NotificationsBody, "NOTIFICATIONS", { unread_only: false, category: "SYSTEM" });
    expect(await screen.findByRole("link", { name: /Disk nearly full/ })).toHaveAttribute("href", "/admin/health");
    expect(screen.getByRole("link", { name: /Welcome/ })).toHaveAttribute("href", "/notifications");
    expect(screen.getByRole("link", { name: "1 unread" })).toBeInTheDocument();
  });

  it("counts all when none are unread, says when empty, and falls back", async () => {
    server.use(
      http.get("/platform/notifications", () =>
        HttpResponse.json({ items: [{ id: "n", title: "Old", severity: "INFO", is_read: true, link: "", created_at: soon }], total: 7, unread: 0 }),
      ),
    );
    draw(NotificationsBody, "NOTIFICATIONS");
    expect(await screen.findByRole("link", { name: "All 7" })).toBeInTheDocument();
    server.use(http.get("/platform/notifications", () => HttpResponse.json({ items: [], total: 0, unread: 0 })));
    draw(NotificationsBody, "NOTIFICATIONS", { unread_only: true });
    expect(await screen.findByText("Nothing unread")).toBeInTheDocument();
    draw(NotificationsBody, "NOTIFICATIONS");
    expect(await screen.findByText("Nothing yet")).toBeInTheDocument();
    server.use(http.get("/platform/notifications", refused));
    draw(NotificationsBody, "NOTIFICATIONS");
    expect(await screen.findByText("could not read notifications")).toBeInTheDocument();
  });
});

describe("announcements", () => {
  it("lists them, pinned first and asking for acknowledgement", async () => {
    server.use(
      http.get("/platform/api/announcements", () =>
        HttpResponse.json({
          items: [
            { id: "a1", title: "Office move", is_pinned: true, read_at: null, requires_acknowledgement: true, acknowledged_at: null, publish_at: soon, created_at: soon },
            { id: "a2", title: "Lunch", is_pinned: false, read_at: soon, requires_acknowledgement: false, acknowledged_at: null, publish_at: null, created_at: soon },
          ],
          unread: 1,
        }),
      ),
    );
    draw(AnnouncementsBody, "ANNOUNCEMENTS", { category: "NEWS" });
    expect(await screen.findByText("Office move")).toBeInTheDocument();
    expect(screen.getByLabelText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("acknowledge")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1 unread" })).toBeInTheDocument();
  });

  it("says when nothing was announced, and falls back", async () => {
    server.use(http.get("/platform/api/announcements", () => HttpResponse.json({ items: [], unread: 0 })));
    draw(AnnouncementsBody, "ANNOUNCEMENTS");
    expect(await screen.findByText("Nothing has been announced")).toBeInTheDocument();
    server.use(http.get("/platform/api/announcements", refused));
    draw(AnnouncementsBody, "ANNOUNCEMENTS");
    expect(await screen.findByText("could not read announcements")).toBeInTheDocument();
  });
});

describe("the explorer's saved searches", () => {
  it("lists them with their dataset and rule count", async () => {
    server.use(
      http.get("/platform/api/saved-searches", () =>
        HttpResponse.json({
          items: [{ id: "s1", name: "Late orders", resource_type: "order", is_favorite: true, rule_count: 3 }],
        }),
      ),
    );
    draw(ExplorerBody, "EXPLORER", { entity: "order" });
    expect(await screen.findByRole("link", { name: /Late orders/ })).toHaveAttribute(
      "href",
      "/explore?resource=order&search=s1",
    );
    expect(screen.getByText("3 rules")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the explorer" })).toHaveAttribute("href", "/explore?resource=order");
  });

  it("invites building one, and falls back", async () => {
    server.use(http.get("/platform/api/saved-searches", () => HttpResponse.json({ items: [] })));
    draw(ExplorerBody, "EXPLORER");
    expect(await screen.findByText(/No saved searches yet/)).toBeInTheDocument();
    server.use(http.get("/platform/api/saved-searches", refused));
    draw(ExplorerBody, "EXPLORER");
    expect(await screen.findByText("could not read saved searches")).toBeInTheDocument();
  });
});

describe("relationships", () => {
  it("lists the most connected records", async () => {
    draw(RelationshipsBody, "RELATIONSHIPS");
    expect(await screen.findByRole("link", { name: /links across/ })).toHaveAttribute("href", "/find/relationships");
  });

  it("says when nothing is connected, and falls back", async () => {
    server.use(
      http.get("/platform/api/relationships/overview", () =>
        HttpResponse.json({ nodes: [], edges: [], hubs: [], totals: { records: 0, entities: 0, relations: 0, links: 0 } }),
      ),
    );
    draw(RelationshipsBody, "RELATIONSHIPS");
    expect(await screen.findByText("Nothing is connected yet")).toBeInTheDocument();
    server.use(http.get("/platform/api/relationships/overview", refused));
    draw(RelationshipsBody, "RELATIONSHIPS");
    expect(await screen.findByText("could not read relationships")).toBeInTheDocument();
  });
});

describe("favourites", () => {
  it("lists bookmarks, or recent visits with their counts", async () => {
    server.use(
      http.get("/platform/favorites", () =>
        HttpResponse.json({ items: [{ id: "b1", url: "/orders/1", label: "Order 1", resource_type: "order" }] }),
      ),
      http.get("/platform/recents", () =>
        HttpResponse.json({
          items: [
            { id: "r1", url: "/tasks/1", label: "Task 1", resource_type: "task", visit_count: 5 },
            { id: "r2", url: "/tasks/2", label: "Task 2", resource_type: "task", visit_count: 1 },
          ],
        }),
      ),
    );
    draw(FavoritesBody, "FAVORITES");
    expect(await screen.findByRole("link", { name: /Order 1/ })).toHaveAttribute("href", "/orders/1");
    expect(screen.getByRole("link", { name: "All favourites" })).toBeInTheDocument();
    draw(FavoritesBody, "FAVORITES", { view: "recents" });
    expect(await screen.findByText("5 visits")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All recents" })).toBeInTheDocument();
  });

  it("says when there is nothing yet, and falls back", async () => {
    server.use(
      http.get("/platform/favorites", () => HttpResponse.json({ items: [] })),
      http.get("/platform/recents", () => HttpResponse.json({ items: [] })),
    );
    draw(FavoritesBody, "FAVORITES");
    expect(await screen.findByText(/Nothing starred yet/)).toBeInTheDocument();
    draw(FavoritesBody, "FAVORITES", { view: "recents" });
    expect(await screen.findByText("Nowhere visited yet")).toBeInTheDocument();
    server.use(http.get("/platform/favorites", refused));
    draw(FavoritesBody, "FAVORITES");
    expect(await screen.findByText("could not read favourites")).toBeInTheDocument();
  });
});

describe("calendar", () => {
  it("lists what is coming, by day, asking for replies", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    server.use(
      http.get("/platform/api/calendar/events", () =>
        HttpResponse.json({
          items: [
            { id: "e2", event_id: "ev2", title: "Review", day: tomorrow, all_day: true, starts_at: `${tomorrow}T00:00:00Z`, color: "#123456", my_response: "ACCEPTED" },
            { id: "e1", event_id: "ev1", title: "Standup", day: today, all_day: false, starts_at: soon, color: "#654321", my_response: "NEEDS_ACTION" },
            { id: "e3", event_id: "ev3", title: "Offsite", day: later, all_day: false, starts_at: null, color: "#000", my_response: null },
          ],
          counts: { awaiting_response: 1 },
        }),
      ),
    );
    draw(CalendarBody, "CALENDAR", { days: 7 });
    expect(await screen.findByText("Standup")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow")).toBeInTheDocument();
    expect(screen.getByText("all day")).toBeInTheDocument();
    expect(screen.getByText("reply")).toBeInTheDocument();
    expect(screen.getByLabelText("Accepted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1 awaiting your reply" })).toBeInTheDocument();
  });

  it("says when the window is empty, and falls back", async () => {
    server.use(
      http.get("/platform/api/calendar/events", () => HttpResponse.json({ items: [], counts: { awaiting_response: 0 } })),
    );
    draw(CalendarBody, "CALENDAR", { days: 1 });
    expect(await screen.findByText("Nothing in the next 1 day")).toBeInTheDocument();
    draw(CalendarBody, "CALENDAR");
    expect(await screen.findByText("Nothing in the next 7 days")).toBeInTheDocument();
    server.use(http.get("/platform/api/calendar/events", refused));
    draw(CalendarBody, "CALENDAR");
    expect(await screen.findByText("could not read calendar")).toBeInTheDocument();
  });
});
