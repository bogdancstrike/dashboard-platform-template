import { Input, Select, Tooltip, Typography } from "antd";

import type { AutomationCatalogue } from "@/api/automations";
import { absoluteTime, relativeTime } from "@/lib/time";

import { Field } from "./Field";
import type { useAutomationDrawer } from "./useAutomationDrawer";

const { Text } = Typography;

/** The cooldowns worth offering, with what each one means for the noise. */
const COOLDOWNS = [
  { value: 0, label: "Every run" },
  { value: 15, label: "15 minutes" },
  { value: 60, label: "1 hour" },
  { value: 240, label: "4 hours" },
  { value: 1440, label: "1 day" },
];

type Drawer = ReturnType<typeof useAutomationDrawer>;

/**
 * Severity, cooldown and schedule, written on change like the task page's
 * triage controls — an automation whose severity is wrong is not worth a form.
 */
export function AutomationSettings({ drawer, catalogue }: { drawer: Drawer; catalogue: AutomationCatalogue }) {
  const { canEdit, write } = drawer;
  const detail = drawer.detail!;
  return (
    <div className="nu-automation-grid">
      <Field label="Severity">
        <Select
          aria-label="Severity"
          value={detail.severity}
          disabled={!canEdit}
          onChange={(severity: string) =>
            write.mutate({ severity: severity as typeof detail.severity })
          }
          options={catalogue.severities.map((item) => ({
            value: item,
            label: item.charAt(0) + item.slice(1).toLowerCase(),
          }))}
        />
      </Field>

      <Field
        label="Say it again after"
        hint="Held per record: a second run is quiet about records it has already acted on, not about the whole rule."
      >
        <Select
          aria-label="Cooldown"
          value={detail.cooldown_minutes}
          disabled={!canEdit}
          onChange={(minutes: number) => write.mutate({ cooldown_minutes: minutes })}
          options={COOLDOWNS}
        />
      </Field>

      <Field
        label="Meant to run"
        hint="Used when the workflow starts on a schedule; the scheduler runs it when it comes due."
      >
        <Input
          aria-label="Schedule"
          className="nu-mono"
          defaultValue={detail.schedule}
          disabled={!canEdit}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (value && value !== detail.schedule) write.mutate({ schedule: value });
          }}
        />
      </Field>

      <Field label="Fired in total">
        <Text data-testid="fired-total">
          {detail.trigger_count}
          {detail.last_triggered_at ? (
            <Tooltip title={absoluteTime(detail.last_triggered_at)}>
              <span> · last {relativeTime(detail.last_triggered_at)}</span>
            </Tooltip>
          ) : null}
        </Text>
      </Field>
    </div>
  );
}
