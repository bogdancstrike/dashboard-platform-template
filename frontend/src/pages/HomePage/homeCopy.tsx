/** The home page's words and rules: the greeting, what is waiting, the shortcuts, the day in a word. */

import type { ReactNode } from "react";
import { NxIcon } from "@/components/NxIcon";

/**
 * How to greet somebody, by their own clock.
 *
 * Pure and exported: it is the one piece of arithmetic on this page, and
 * "good evening" at nine in the morning is the sort of thing that makes a
 * whole page feel careless.
 */
export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** One thing waiting for the reader, and where to go and do it. */
export interface Waiting {
  key: string;
  count: number;
  label: string;
  to: string;
  icon: ReactNode;
}

/**
 * The things that are actually waiting, in the order they should be dealt with.
 *
 * Pure and exported, because the *rule* is the interesting part: a count of
 * nought is dropped rather than rendered, and the order is by urgency and not
 * by size. Twelve unread notifications are less urgent than one policy nobody
 * has agreed to, and sorting by count would put them first every time.
 */
export function whatIsWaiting(counts: {
  acknowledgements: number;
  invitations: number;
  mail: number;
  notifications: number;
  overdue: number;
}): Waiting[] {
  /** Singular or plural, because "1 of your tasks are past due" reads as a bug. */
  const both = (count: number, one: string, many: string) => (count === 1 ? one : many);

  const all: Waiting[] = [
    {
      key: "acknowledgements",
      count: counts.acknowledgements,
      label: both(counts.acknowledgements, "notice to agree to", "notices to agree to"),
      to: "/announcements",
      icon: <NxIcon name="megaphone" />,
    },
    {
      key: "overdue",
      count: counts.overdue,
      label: both(
        counts.overdue,
        "of your tasks is past its due date",
        "of your tasks are past their due date",
      ),
      to: "/tasks",
      icon: <NxIcon name="check" />,
    },
    {
      key: "invitations",
      count: counts.invitations,
      label: both(counts.invitations, "invitation to answer", "invitations to answer"),
      to: "/calendar?view=agenda&mine=1",
      icon: <NxIcon name="calendar" />,
    },
    {
      key: "mail",
      count: counts.mail,
      label: both(counts.mail, "unread conversation", "unread conversations"),
      to: "/mail?only=unread",
      icon: <NxIcon name="mail" />,
    },
    {
      key: "notifications",
      count: counts.notifications,
      label: both(counts.notifications, "unread notification", "unread notifications"),
      to: "/notifications",
      icon: <NxIcon name="bell" />,
    },
  ];
  // Nought is dropped, never drawn: a row of zeroes teaches a reader to stop
  // looking at the strip, and then the one that is not zero is invisible too.
  return all.filter((item) => item.count > 0);
}

/** One door out of the lobby: where it goes, and what it needs to be open. */
export interface Shortcut {
  key: string;
  label: string;
  hint: string;
  to: string;
  icon: ReactNode;
  /** The permission it needs. Absent means everybody. */
  permission?: string;
}

/**
 * The modules a person actually starts in.
 *
 * Deliberately *destinations* and not "create" buttons. A tile labelled
 * "New email" that lands on an inbox is a lie somebody only falls for once,
 * and the pages own their own creating — this is a front door, not a second
 * set of verbs. Each names the permission that gates its page, so the row
 * holds no door that opens onto a 403 (§76).
 *
 * Exported and pure, because "which of these does this role see" is the
 * interesting part and it is worth asserting without rendering a page.
 */
export const SHORTCUTS: Shortcut[] = [
  {
    key: "explore",
    label: "Explore data",
    hint: "Ask anything of any dataset",
    to: "/explore",
    icon: <NxIcon name="search" size={16} />,
    permission: "records.view",
  },
  {
    key: "dashboards",
    label: "Dashboards",
    hint: "The layouts you composed",
    to: "/dashboards",
    icon: <NxIcon name="layout" size={16} />,
    permission: "dashboards.manage",
  },
  {
    key: "analytics",
    label: "Analytics",
    hint: "Trends, breakdowns, comparisons",
    to: "/analytics",
    icon: <NxIcon name="area" size={16} />,
    permission: "records.view",
  },
  {
    key: "mail",
    label: "Mail",
    hint: "Your conversations",
    to: "/mail",
    icon: <NxIcon name="mail" size={16} />,
    permission: "mail.access",
  },
  {
    key: "files",
    label: "Files",
    hint: "Documents and uploads",
    to: "/files",
    icon: <NxIcon name="folder" size={16} />,
    permission: "files.view",
  },
  {
    key: "favorites",
    label: "Favourites",
    hint: "What you starred",
    to: "/favorites",
    icon: <NxIcon name="heart" size={16} />,
  },
];

/** Today, written the way somebody would say it out loud. */
export function longDate(now: Date = new Date()): string {
  return now.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * One sentence describing the day, from the same counts the strip draws.
 *
 * The strip says *what* is waiting; this says whether the day is busy — which
 * is the thing somebody actually wants from a glance at a landing page, and
 * which no arrangement of five tiles conveys. Pure, so the wording is
 * testable without a page around it.
 */
export function dayInAWord(waiting: Waiting[], meetings: number): string {
  const jobs = waiting.reduce((sum, item) => sum + item.count, 0);
  const diary =
    meetings === 0
      ? "nothing in your calendar"
      : meetings === 1
        ? "one thing in your calendar"
        : `${meetings} things in your calendar`;
  if (jobs === 0) return `Nothing is waiting for you, and ${diary}.`;
  const items = waiting.length === 1 ? "one thing" : `${waiting.length} kinds of thing`;
  return `${items} waiting on you, and ${diary}.`;
}
