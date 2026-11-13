/** The announcement editor's vocabulary and values: what the form offers, how it starts, what it sends. */

import dayjs, { type Dayjs } from "dayjs";

import type { Announcement, AnnouncementInput } from "@/api/announcements";

/**
 * The categories and severities the server accepts.
 *
 * Typed out here rather than fetched: they are a *vocabulary*, not data, and
 * an extra request on every open of a drawer to learn five constants is a
 * request that fails at exactly the wrong moment. The server validates them
 * either way — `services/announcements.CATEGORIES` is the authority, and a
 * value this offers which it rejects is a 400 with the allowed list in it.
 */
export const CATEGORIES = [
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "RELEASE", label: "Release" },
  { value: "INCIDENT", label: "Incident" },
  { value: "POLICY", label: "Policy" },
  { value: "NEWS", label: "News" },
];

export const ROLES = [
  { value: "ADMINISTRATOR", label: "Administrators" },
  { value: "MANAGER", label: "Managers" },
  { value: "OPERATOR", label: "Operators" },
  { value: "ANALYST", label: "Analysts" },
  { value: "VIEWER", label: "Viewers" },
];

/**
 * Whether a notice's window makes sense, as a plain function.
 *
 * Exported and tested directly rather than through the picker: driving a
 * range picker in jsdom asserts AntD's keyboard handling, not this rule, and
 * it took nine seconds to do it. The server checks the same thing and its
 * answer is the one that counts (`services/announcements._validated`); this
 * exists so the mistake is caught while somebody is still typing.
 */
export function windowProblem(
  from: Dayjs | null | undefined,
  to: Dayjs | null | undefined,
): string | null {
  if (!from || !to) return null;
  return to.isAfter(from) ? null : "A notice cannot expire before it is published";
}

export interface FormValues {
  title: string;
  body: string;
  category: string;
  severity: string;
  status: string;
  window?: [Dayjs | null, Dayjs | null] | null;
  audience_roles?: string[];
  requires_acknowledgement?: boolean;
  is_pinned?: boolean;
  link?: string;
}

/** The form's values for `notice`, or for a new one. */
export function seedValues(
  notice: Announcement | null,
): Omit<FormValues, "window"> & { window: [Dayjs, Dayjs | null] } {
  return {
    title: notice?.title ?? "",
    body: notice?.body ?? "",
    category: notice?.category ?? "NEWS",
    severity: notice?.severity ?? "INFO",
    status: notice?.status ?? "DRAFT",
    window: [
      notice?.publish_at ? dayjs(notice.publish_at) : dayjs(),
      notice?.expires_at ? dayjs(notice.expires_at) : null,
    ],
    audience_roles: notice?.audience_roles ?? [],
    requires_acknowledgement: notice?.requires_acknowledgement ?? false,
    is_pinned: notice?.is_pinned ?? false,
    link: notice?.link ?? "",
  };
}

/** What the server is sent for the form's values. */
export function toInput(values: FormValues): AnnouncementInput {
  const [from, to] = values.window ?? [null, null];
  return {
    title: values.title,
    body: values.body,
    category: values.category,
    severity: values.severity,
    status: values.status,
    publish_at: from ? from.toISOString() : null,
    expires_at: to ? to.toISOString() : null,
    audience_roles: values.audience_roles ?? [],
    requires_acknowledgement: Boolean(values.requires_acknowledgement),
    is_pinned: Boolean(values.is_pinned),
    link: values.link?.trim() || null,
  };
}
