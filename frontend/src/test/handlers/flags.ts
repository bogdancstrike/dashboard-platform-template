/**
 * Feature-flag administration beyond the list (§27): preview-as and history.
 * The list, create, update and delete handlers live beside the fixture rows in
 * `handlers.ts`, which these read.
 */

import { http, HttpResponse } from "msw";

import { flagRows } from "@/test/handlers";

export const flagHandlers = [
  http.get("/platform/admin/flags/preview", ({ request }) => {
    const role = new URL(request.url).searchParams.get("role") ?? "";
    // A viewer has nothing beyond the GA flags; everybody else has what is on.
    const features = Object.fromEntries(
      flagRows.map((row) => [
        String(row["key"]),
        Boolean(row["enabled"]) && (role !== "VIEWER" || row["key"] !== "time-tracking"),
      ]),
    );
    return HttpResponse.json({
      role,
      user_id: null,
      features,
      off: Object.keys(features).filter((key) => !features[key]),
      depends_on_person: flagRows.filter((row) => row["partial"]).map((row) => String(row["key"])),
    });
  }),
  http.get("/platform/admin/flags/:key/history", ({ params }) =>
    HttpResponse.json({
      key: String(params["key"]),
      items:
        params["key"] === "time-tracking"
          ? [
              {
                id: "h1",
                at: "2026-11-01T09:00:00Z",
                actor: "Ada Administrator",
                actor_id: null,
                message: "disabled Time tracking",
                before: { enabled: true },
                after: { enabled: false },
                changed_fields: ["enabled"],
              },
            ]
          : [],
    }),
  ),
];
