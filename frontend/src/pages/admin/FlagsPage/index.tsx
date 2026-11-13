/**
 * `/admin/flags` — feature flags (§27, §20).
 *
 * Every flag here is *real*: the server's catalogue says what each one gates —
 * routes, menu entries, API endpoints, background jobs, live messages and the
 * components inside other pages — and the API refuses a switched-off feature
 * with `feature_disabled`. This screen is where that is decided, so it says
 * exactly what a switch will do before it is flipped.
 *
 * Five decisions worth stating.
 *
 * **Grouped by where the feature lives.** Fifty-odd flags in one table is a
 * list nobody can scan; grouped by the product's own areas (Overview, AI,
 * Work…) it reads like the navigation it controls. Search narrows across all.
 *
 * **Turning something off is confirmed, with the blast radius.** The dialog
 * lists the routes that will show "switched off", the menu entries and
 * components that disappear, the endpoints that will refuse, and the flags
 * that go with it. Turning one *on* restores what it guards and needs no
 * ceremony.
 *
 * **Every row answers "and do *I* have it?"** — computed by the server with
 * the same rule it gates with — and "preview as" answers it for any role.
 *
 * **Rollout and targeting live in a drawer** (people, roles, groups,
 * organizations, a percentage), beside what the flag controls and its audit
 * history: who changed it, when, from what to what.
 *
 * **Deleting is refused while it is on**, by the server, and the page says
 * why before it is tried.
 */

import { Alert, Skeleton } from "antd";

import { PageHeader } from "@/components/PageHeader";
import { usePhoneList } from "@/components/listing/ResponsiveTable";
import { apiMessage } from "@/lib/errors";
import "@/styles/flags.css";

import { FlagDrawer } from "./FlagDrawer";
import { FlagGroups } from "./FlagGroups";
import { FlagControls, FlagCounts, PreviewSummary } from "./FlagToolbar";
import { NewFlagModal } from "./NewFlagModal";
import { TurnOffModal } from "./TurnOffModal";
import { groupedFlags } from "./flagReach";
import { useFlagsPage } from "./useFlagsPage";

export { ControlsList } from "./ControlsList";
export { blastRadius, reachOf } from "./flagReach";

export default function FlagsPage() {
  const phone = usePhoneList();
  const page = useFlagsPage();
  const { flags, drawer, write, roles } = page;

  if (flags.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (flags.isError) {
    return (
      <div className="nx-ad nx-ad--flags">
        <PageHeader title={<>Feature <em>flags</em></>} />
        <Alert type="error" showIcon message={apiMessage(flags.error, "The flags could not be loaded.")} />
      </div>
    );
  }

  const data = flags.data!;
  const groups = groupedFlags(data.items, data.areas, page.state, page.term);
  const areaLabels = Object.fromEntries((data.areas ?? []).map((area) => [area.key, area.label]));
  const selected = data.items.find((flag) => flag.key === drawer.value);

  return (
    <div className="nx-ad nx-ad--flags">
      <PageHeader
        title={<>Feature <em>flags</em></>}
        subtitle="What is switched on, for whom, and what switching it off takes away. Changes reach every open tab at once."
        tag={<FlagCounts counts={data.counts} />}
        actions={<FlagControls page={page} total={data.counts.total} on={data.counts.on} phone={phone} />}
      />

      <PreviewSummary page={page} />

      <FlagGroups page={page} groups={groups} areaLabels={areaLabels} phone={phone} />

      <TurnOffModal page={page} />

      <FlagDrawer
        flag={selected}
        open={Boolean(drawer.value)}
        names={page.names}
        roles={(roles.data?.items ?? []).map((role) => ({ value: role.code, label: role.name }))}
        saving={write.isPending}
        onClose={drawer.close}
        onSave={(body) => selected && write.mutate({ key: selected.key, body })}
      />

      <NewFlagModal open={page.creating} onClose={() => page.setCreating(false)} onCreated={page.refresh} />
    </div>
  );
}
