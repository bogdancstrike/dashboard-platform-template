/**
 * `/settings/security` — your own sessions, sign-ins and warnings (§41).
 *
 * Six decisions worth the reader's attention.
 *
 * **This page needs no permission, and that is deliberate.** Being signed in is
 * the qualification for seeing your own sessions. A security page that had to be
 * granted would be one most people never see, and its whole value is that the
 * person whose account it is can look without asking anybody. It is reached
 * from the profile menu rather than the navigation, because it is about *you*
 * rather than about the platform.
 *
 * **The page opens with a sentence, not a row of numbers.** "Is anything wrong"
 * is the question, and four counters make a reader do the arithmetic
 * themselves. The one number that earns its own line is the failed sign-in
 * count, and only once there have been enough of them to mean something — the
 * server decides that, so the threshold is not a browser's opinion.
 *
 * **Failed sign-ins are not merged into a history list.** Somebody trying your
 * password from an address you do not recognise is exactly what this page
 * exists to show, so failures have their own filter, their own colour and their
 * own line at the top. A "recent activity" feed that mixed them with successes
 * would bury the only rows that matter.
 *
 * **The session you are using is marked, and revoking it is a separate act.**
 * Signing yourself out is a reasonable thing to want, but pressing "revoke"
 * down a list and landing on your own row is how somebody loses their work —
 * so it carries a different confirmation that says what will happen.
 *
 * **Every control asks the server whether it is allowed.** `can_revoke` arrives
 * on each row; this page never decides for itself whether a session may be
 * signed out. An expired one has nothing to revoke, and a button that
 * changed nothing would be worse than no button (§76).
 *
 * **Nothing here deletes.** A session is revoked, an event is resolved, and
 * the history is a record — a security page whose rows can be tidied away is
 * one an attacker tidies away.
 */

import { Alert, Skeleton } from "antd";

import { PageHeader } from "@/components/PageHeader";
import { SettingsNav } from "@/components/layout/SettingsNav";
import { relativeTime } from "@/lib/time";

import { EventsCard } from "./EventsCard";
import { SessionsCard } from "./SessionsCard";
import { SignInsCard } from "./SignInsCard";
import { SecurityActions } from "./SecurityActions";
import { headline, headlineTone } from "./securityCopy";
import { useSecurityPage } from "./useSecurityPage";

export { headline, headlineTone, sessionSituation, sessionTone, severityTone } from "./securityCopy";

export default function SecurityPage() {
  const page = useSecurityPage();
  const { overview } = page;

  if (overview.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  return (
    <div className="nu-sec nx-fd-sec">
      <PageHeader
        title="Security"
        subtitle="Where your account is signed in, who has tried to, and anything the platform has noticed."
        actions={<SecurityActions page={page} />}
      />

      <div className="nx-fd-settings">
      <SettingsNav
        label="Security sections"
        sections={[
          ["sessions-card", "Where you are signed in"],
          ["sign-ins-card", "Sign-in history"],
          ["events-card", "What the platform noticed"],
        ]}
      />
      <div className="nx-fd-setcol">
      {overview.data ? (
        <Alert
          type={headlineTone(overview.data)}
          showIcon
          className="nu-sec-headline"
          data-testid="security-headline"
          message={headline(overview.data)}
          description={
            overview.data.last_signed_in_at ? (
              <span data-testid="last-sign-in">
                Last signed in {relativeTime(overview.data.last_signed_in_at)} on{" "}
                {overview.data.last_signed_in_on} from{" "}
                {overview.data.last_signed_in_from ?? "an unrecorded address"}.
              </span>
            ) : undefined
          }
        />
      ) : null}

      <SessionsCard page={page} />
      <SignInsCard page={page} />
      <EventsCard page={page} />
      </div>
      </div>
    </div>
  );
}
