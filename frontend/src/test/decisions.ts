import { http, HttpResponse } from "msw";

import { currentUser } from "@/test/handlers";
import { server } from "@/test/server";

/** The fixture administrator with the Time & decisions permissions added. */
export function grantDecisions(...extra: string[]): void {
  server.use(
    http.get("/platform/api/me", () =>
      HttpResponse.json({
        ...currentUser,
        permissions: [
          ...currentUser.permissions, "time.track", "time.approve", "approvals.decide", "sla.manage",
          "forms.manage", "records.export", ...extra,
        ],
      }),
    ),
  );
}

/** The same administrator with only `permissions` — for the "you may not" cases. */
export function onlyPermissions(...permissions: string[]): void {
  server.use(
    http.get("/platform/api/me", () => HttpResponse.json({ ...currentUser, permissions })),
  );
}
