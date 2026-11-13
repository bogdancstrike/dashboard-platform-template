import { Alert, Card, Skeleton, Tabs } from "antd";

import { ApiError } from "@/api/client";
import { useSmartBack } from "@/app/history";
import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { PageHeader } from "@/components/PageHeader";

import { AccessTab } from "./AccessTab";
import { ProfileTab } from "./ProfileTab";
import { SecurityTab } from "./SecurityTab";
import { UserControls } from "./UserControls";
import { UserHeader } from "./UserHeader";
import { useUserDetailPage } from "./useUserDetailPage";

/**
 * One person (§12).
 *
 * The tab that matters is **Access**, and it answers a question a role alone
 * cannot: *why* can this person do that? Permissions arrive from two places —
 * the role and every group they are in — and the API enforces the union. A
 * screen showing only "Role: Manager" leaves an administrator staring at
 * somebody who can cancel jobs with no way to find out how.
 */
export default function UserDetailPage() {
  const back = useSmartBack();
  const page = useUserDetailPage();
  const { person, tab, setParams } = page;

  if (person.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (person.isError) {
    const error = person.error;
    const missing = error instanceof ApiError && error.isNotFound;
    return (
      <div className="nx-ad nx-ad--user">
        <PageHeader
          title={missing ? "Person not found" : "Could not open this profile"}
          onBack={() => back("/admin/users")}
        />
        <Alert
          type={missing ? "warning" : "error"}
          showIcon
          message={
            missing
              ? "The account may have been removed, or the link may be wrong."
              : error instanceof ApiError
                ? error.message
                : "The request failed."
          }
        />
      </div>
    );
  }

  const user = person.data!;

  return (
    <div className="nx-ad nx-ad--user">
      <UserHeader page={page} user={user} onBack={() => back("/admin/users")} />

      <UserControls page={page} user={user} />

      <Tabs
        className="nx-ad-tabs"
        activeKey={tab}
        onChange={(key) =>
          setParams(
            (current) => {
              const next = new URLSearchParams(current);
              if (key === "access") next.delete("tab");
              else next.set("tab", key);
              return next;
            },
            // Pushed: a tab is a place, so back returns to the previous one.
          )
        }
        items={[
          { key: "access", label: "Access", children: <AccessTab user={user} /> },
          {
            key: "profile",
            label: "Profile",
            children: <ProfileTab user={user} />,
          },
          {
            key: "security",
            label: "Sessions & sign-ins",
            children: <SecurityTab sessions={user.sessions} signIns={user.sign_ins} />,
          },
          {
            key: "history",
            label: "History",
            children: (
              <Card size="small">
                <AuditTimeline resourceType="user" resourceId={user.id} />
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
