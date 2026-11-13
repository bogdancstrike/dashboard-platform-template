/**
 * `/home` — where a person arrives (§40, §20).
 *
 * Five decisions worth stating.
 *
 * **This is not the dashboard, and the difference is the whole point.**
 * `/dashboard` answers "how is the business doing" with the organisation's
 * numbers. This answers "what is waiting for *me*" — and a landing page that
 * opened on revenue is a landing page somebody scrolls past every morning to
 * find the three things they actually have to do.
 *
 * **It adds no endpoint.** Every number here comes from the endpoint the
 * dedicated page uses: the notices from `/api/announcements`, the
 * notification count from `/notifications/counts`, today from the calendar's
 * own window, unread mail from the mailbox's own list, the tasks from the same
 * explorer query the board runs. A `/api/home/summary` would be a second place
 * every one of those is computed, and the first time the two disagreed nobody
 * would know which was right. Six parallel requests, each cached and shared
 * with the page it belongs to, is the cheaper mistake.
 *
 * **Only actionable things are counted.** "1,284 tasks exist" is a fact nobody
 * acts on; "3 invitations you have not answered" is three clicks of work. Each
 * count is a link to the narrowed view that shows exactly those rows, so the
 * number and the page behind it cannot disagree about what it meant.
 *
 * **A count of nought is not shown as nought** — it is not shown. A row of
 * zeroes teaches a reader to stop looking at the strip, and then the one that
 * is not zero is invisible too. When everything is clear, the strip says so in
 * a sentence instead.
 *
 * **What a reader lacks permission for is absent, not empty.** Somebody with
 * no mailbox does not get a mailbox card reading nought; they get one fewer
 * card. An empty card for a feature you cannot use is a worse answer than no
 * card at all (§76).
 *
 * **It is a front door, not a report.** The page used to be a greeting, a
 * strip of counts and four identical cards of lists — correct, and about as
 * welcoming as a spreadsheet. Three things changed that without adding an
 * endpoint or a claim:
 *
 * * a **hero band** carrying the date, who you are signed in as, and one
 *   sentence saying what the day looks like — because the first thing a
 *   landing page should do is orient somebody, and "Good morning" alone does
 *   not;
 * * **shortcuts into the modules**, permission-aware, because a front door
 *   with no doors is a lobby;
 * * **"jump back in"**, from `/recents` — the single most useful thing a
 *   landing page can offer, since most mornings start by reopening whatever
 *   was being worked on yesterday.
 *
 * The layout is a wide column and a rail rather than four equal cards: what
 * is *yours* (today, your work, what happened) reads left to right and gets
 * the width; what is *the platform's* (notices, shortcuts, where you have
 * been) sits beside it.
 */

import { Skeleton } from "antd";

import { DailyBrief } from "@/components/assistant/DailyBrief";
import { OnboardingCard } from "@/components/onboarding/OnboardingCard";

import { ActivityCard } from "./parts/ActivityCard";
import { HomeHero } from "./parts/HomeHero";
import { NoticesCard } from "./parts/NoticesCard";
import { RecentsCard } from "./parts/RecentsCard";
import { ShortcutsCard } from "./parts/ShortcutsCard";
import { TodayCard } from "./parts/TodayCard";
import { WaitingStrip } from "./parts/WaitingStrip";
import { WorkCard } from "./parts/WorkCard";
import { useHomePage } from "./useHomePage";

export default function HomePage() {
  const page = useHomePage();
  if (!page.profile) return <Skeleton active paragraph={{ rows: 10 }} />;

  return (
    <div className="nu-home nx-ov-home">
      <HomeHero page={page} />

      {/* Only what is actually waiting, each one a link to the rows it
          counted. A strip of zeroes teaches a reader to ignore the strip. */}
      <WaitingStrip page={page} />

      {/* The AI brief (§45): the same waiting work, ranked and explained. */}
      <DailyBrief />

      {/* Getting started (§38): this person's checklist, until dismissed. */}
      <OnboardingCard />

      {/* A wide column and a rail. What is *yours* — today, your work, what
          happened — reads left to right and gets the width; what is the
          platform's — the doors, where you have been, the noticeboard — sits
          beside it. Four equal cards gave a diary the same weight as a
          shortcut, which is how the page read as a wall of lists. */}
      <div className="nu-home-columns">
        <div className="nu-home-main">
          <TodayCard page={page} />

          <WorkCard page={page} />

          <ActivityCard page={page} />
        </div>

        <aside className="nu-home-rail">
          <ShortcutsCard page={page} />

          <RecentsCard page={page} />

          <NoticesCard page={page} />
        </aside>
      </div>
    </div>
  );
}
