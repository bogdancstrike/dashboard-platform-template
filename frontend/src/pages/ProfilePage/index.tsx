/**
 * A person's own page, and a colleague's (§40, §41).
 *
 * There was nowhere in this platform a reader could look at *themselves*. Their
 * access was visible only to an administrator opening `/admin/users/:id` —
 * which is the page the person asking cannot open — so the commonest support
 * question in any platform of this shape, "why can I not export?", had no
 * self-service answer at all. That question is what the overview leads with.
 *
 * Four decisions worth the reader's attention.
 *
 * **Three tabs, not five.** Overview, Activity, Access. Preferences and
 * security are whole pages already, at `/settings/preferences` and
 * `/settings/security`, and re-hosting either here would put one page at two
 * addresses — two things to keep in step, two axe runs, and a bookmark that
 * points at whichever a reader happened to find. What this page carries instead
 * is a *digest* of each with a way through: "dark, compact, Europe/Bucharest"
 * and "3 devices signed in" are useful at a glance and are not a second copy
 * of the screen that sets them.
 *
 * **The withholding is drawn, not hidden.** A colleague's page shows what the
 * directory shows; the server says which parts it withheld and the page names
 * them, because a panel that is empty for want of permission is
 * indistinguishable from a panel that is broken (§76).
 *
 * **Every number opens the rows behind it** (§44). "18 tasks in hand" that
 * cannot be clicked is a number nobody can check.
 *
 * **The charts are dense.** Every week has a bar and every hour has a cell,
 * because a chart drawn only where there is data reports a quiet week as no
 * week at all — the server sends the empty buckets and this draws them.
 */

import { Skeleton, Tabs } from "antd";

import { useSmartBack } from "@/app/history";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { EditProfileDrawer } from "@/components/profile/EditProfileDrawer";
import { ProfileAccessTab, ProfileActivityTab } from "@/components/profile/ProfileTabs";
import { StatusTag } from "@/components/StatusTag";

import { IdentityCard } from "./IdentityCard";
import { OverviewTab, ProfileHeatmap } from "./OverviewTab";
import { ProfileActions } from "./ProfileActions";
import { whereTheySit } from "./profilePanels";
import { useProfilePage } from "./useProfilePage";

export { TABS, WEEKDAYS, heatmapPanel, tabFrom, throughputPanel, whereTheySit, type ProfileTab } from "./profilePanels";

export default function ProfilePage() {
  const back = useSmartBack();
  const { userId, params, setParams, editing, setEditing, auth, tab, query, profile, activityKind, activity } = useProfilePage();

  if (query.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (query.error || !profile) {
    return (
      <EmptyState
        title="That page could not be loaded"
        hint="The person may have been removed, or you may not be allowed to see them."
      />
    );
  }

  const mine = profile.is_me;

  const [firstName, ...restName] = profile.user.full_name.split(" ");

  return (
    <div className="nx-fd-profile">
      <PageHeader
        title={
          restName.length ? (
            <span>
              {firstName} <em>{restName.join(" ")}</em>
            </span>
          ) : (
            profile.user.full_name
          )
        }
        tag={<StatusTag status={profile.user.status} />}
        subtitle={whereTheySit(profile)}
        onBack={userId ? () => back("/admin/users") : undefined}
        actions={<ProfileActions profile={profile} onEdit={() => setEditing(true)} />}
      />

      <IdentityCard profile={profile} />

      <Tabs
        className="nu-profile-tabs"
        activeKey={tab}
        onChange={(key) => {
          const next = new URLSearchParams(params);
          // In the URL, so a tab is linkable and survives a reload (§69).
          if (key === "overview") next.delete("tab");
          else next.set("tab", key);
          next.delete("kind");
          // Pushed, so back returns to the tab you were on.
          setParams(next);
        }}
        items={[
          {
            key: "overview",
            label: "Overview",
            children: <OverviewTab profile={profile} mine={mine} auth={auth} />,
          },
          {
            key: "activity",
            label: "Activity",
            children: (
              <ProfileActivityTab
                profile={profile}
                feed={activity.data}
                loading={activity.isLoading}
                kind={activityKind}
                onKind={(next) => {
                  const search = new URLSearchParams(params);
                  if (next) search.set("kind", next);
                  else search.delete("kind");
                  setParams(search, { replace: true });
                }}
                heatmap={<ProfileHeatmap profile={profile} />}
              />
            ),
          },
          {
            key: "access",
            label: "Access",
            children: <ProfileAccessTab profile={profile} />,
          },
        ]}
      />

      {mine && (
        <EditProfileDrawer
          open={editing}
          profile={auth.profile ?? undefined}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
