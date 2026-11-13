import { useEffect, useState } from "react";
import { Button, Drawer, Tabs } from "antd";

import type { FeatureFlag } from "@/api/settings";
import { URL_OVERLAY } from "@/app/history";
import { EmptyState } from "@/components/EmptyState";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

import { ControlsList } from "./ControlsList";
import { FlagHistory } from "./FlagHistory";
import { TargetingForm, type Targeting } from "./TargetingForm";

/** Rollout and targeting, what the flag controls, and its history. */
/**
 * The drawer's working copy of the targeting, reset whenever the flag changes.
 *
 * Targeting is a set of choices somebody made one by one; closing the drawer
 * with them unsaved asks first (§76), so every edit arms the guard.
 */
function useFlagDraft(flag: FeatureFlag | undefined, guard: ReturnType<typeof useDiscardGuard>) {
  const [draft, setDraftState] = useState<Targeting | null>(null);
  const setDraft = (next: Targeting) => {
    guard.touch();
    setDraftState(next);
  };
  useEffect(() => {
    if (!flag) return;
    guard.settled();
    setDraftState({
      rollout_percentage: flag.rollout_percentage,
      target_roles: flag.target_roles,
      target_group_ids: flag.target_group_ids ?? [],
      target_organization_ids: flag.target_organization_ids ?? [],
    });
    // `guard.settled` is stable; re-running on it would reset the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag]);

  const changed =
    flag !== undefined &&
    draft !== null &&
    (draft.rollout_percentage !== flag.rollout_percentage ||
      draft.target_roles.join() !== flag.target_roles.join() ||
      draft.target_group_ids.join() !== (flag.target_group_ids ?? []).join() ||
      draft.target_organization_ids.join() !== (flag.target_organization_ids ?? []).join());
  return { draft, setDraft, changed };
}

export function FlagDrawer({
  flag,
  open,
  names,
  roles,
  saving,
  onClose,
  onSave,
}: {
  flag: FeatureFlag | undefined;
  open: boolean;
  names: Record<string, string>;
  roles: { value: string; label: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: (body: Partial<Targeting>) => void;
}) {
  const guard = useDiscardGuard({ close: onClose, what: "targeting" });
  const { draft, setDraft, changed } = useFlagDraft(flag, guard);

  return (
    <Drawer
      open={open}
      onClose={guard.requestClose}
      rootClassName={URL_OVERLAY}
      width={560}
      title={flag ? flag.name : "Flag"}
      data-testid="flag-drawer"
      extra={
        <Button
          type="primary"
          disabled={!changed}
          loading={saving}
          onClick={() => {
            if (!draft) return;
            guard.settled();
            onSave(draft);
          }}
          data-testid="save-targeting"
        >
          Save
        </Button>
      }
    >
      {!flag || !draft ? (
        <EmptyState compact title="That flag does not exist." />
      ) : (
        <Tabs
          items={[
            {
              key: "rollout",
              label: "Rollout & targeting",
              children: <TargetingForm flag={flag} draft={draft} setDraft={setDraft} roles={roles} open={open} />,
            },
            {
              key: "controls",
              label: "What it controls",
              children: <ControlsList controls={flag.controls} names={names} />,
            },
            {
              key: "history",
              label: "History",
              children: <FlagHistory flag={flag} open={open} />,
            },
          ]}
        />
      )}
    </Drawer>
  );
}
