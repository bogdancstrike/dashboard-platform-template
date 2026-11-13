import { Button, Card, Input, Select, Space, Typography } from "antd";
import { DeleteOutlined } from "@ant-design/icons";

import type { AutomationAction, AutomationCatalogue } from "@/api/automations";
import { PeoplePicker } from "@/components/PeoplePicker";

import { Field } from "./Field";
import { PLACEHOLDERS, actionProblem } from "./actionRules";

const { Text } = Typography;

interface ActionCardProps {
  action: AutomationAction;
  index: number;
  catalogue: AutomationCatalogue;
  disabled?: boolean;
  /** Merge changes into this action. */
  replace: (index: number, changes: Partial<AutomationAction>) => void;
  /** Swap this action for a fresh one of another kind. */
  onKind: (kind: string) => void;
  onRemove: () => void;
}

/** One action: its kind, the fields its declaration says it needs, and what is wrong with it. */
export function ActionCard({ action, index, catalogue, disabled, replace, onKind, onRemove }: ActionCardProps) {
  const spec = catalogue.actions.find((item) => item.kind === action.kind);
  const needs = spec?.needs ?? [];
  const problem = actionProblem(action, needs);
  return (
    <Card
      size="small"
      className="nu-action-card"
      data-testid={`action-${index}`}
      title={
        <Space size={8}>
          <Select
            size="small"
            aria-label={`Action ${index + 1}`}
            value={action.kind}
            disabled={disabled}
            style={{ minWidth: 160 }}
            onChange={onKind}
            options={catalogue.actions.map((item) => ({
              value: item.kind,
              label: item.label,
            }))}
          />
          <Text type="secondary" className="nu-action-hint">
            {spec?.description}
          </Text>
        </Space>
      }
      extra={
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          disabled={disabled}
          aria-label={`Remove action ${index + 1}`}
          onClick={onRemove}
        />
      }
    >
      <div className="nu-action-grid">
        {needs.includes("recipients") && <RecipientFields action={action} index={index} disabled={disabled} catalogue={catalogue} replace={replace} />}

        {needs.includes("url") && (
          <Field label="POST to" wide>
            <Input
              aria-label={`Webhook URL ${index + 1}`}
              placeholder="https://example.internal/hooks/nucleus"
              value={action.url ?? ""}
              disabled={disabled}
              onChange={(event) => replace(index, { url: event.target.value })}
            />
          </Field>
        )}

        {action.kind !== "WEBHOOK" && (
          <Field
            label={action.kind === "EMAIL" ? "Subject" : "Title"}
            wide={action.kind === "EMAIL"}
          >
            <Input
              aria-label={`Wording ${index + 1}`}
              placeholder="{rule}: {record}"
              value={
                (action.kind === "EMAIL" ? action.subject : action.title) ?? ""
              }
              disabled={disabled}
              onChange={(event) =>
                replace(
                  index,
                  action.kind === "EMAIL"
                    ? { subject: event.target.value }
                    : { title: event.target.value },
                )
              }
            />
          </Field>
        )}

        {action.kind === "TASK" && (
          <Field label="Priority">
            <Select
              aria-label={`Priority ${index + 1}`}
              value={action.priority ?? "HIGH"}
              disabled={disabled}
              onChange={(priority: string) => replace(index, { priority })}
              options={catalogue.priorities.map((item) => ({
                value: item,
                label: item.charAt(0) + item.slice(1).toLowerCase(),
              }))}
            />
          </Field>
        )}
      </div>

      {action.kind !== "WEBHOOK" && (
        <Text type="secondary" className="nu-action-placeholders">
          Wording may use {PLACEHOLDERS}
        </Text>
      )}

      {/* Named in place, beside the field that fixes it (§76) — rather
          than as a save-time refusal somebody has to interpret. */}
      {problem && (
        <Text type="danger" className="nu-action-problem" role="alert">
          {problem}
        </Text>
      )}
    </Card>
  );
}

function RecipientFields({ action, index, disabled, catalogue, replace }: Omit<ActionCardProps, "onKind" | "onRemove">) {
  return (
    <>
      <>
        <Field label="Anybody holding">
          <Select
            allowClear
            aria-label={`Role ${index + 1}`}
            placeholder="No role"
            value={action.recipients?.role || undefined}
            disabled={disabled}
            onChange={(role: string | undefined) =>
              replace(index, {
                recipients: {
                  user_ids: action.recipients?.user_ids ?? [],
                  role: role ?? "",
                  owner: action.recipients?.owner ?? false,
                },
              })
            }
            options={catalogue.roles.map((role) => ({
              value: role.code,
              label: role.name,
            }))}
          />
        </Field>
        <Field label="And these people">
          <PeoplePicker
            aria-label={`People ${index + 1}`}
            placeholder="Nobody in particular"
            disabled={disabled}
            value={action.recipients?.user_ids ?? []}
            onChange={(ids) =>
              replace(index, {
                recipients: {
                  user_ids: ids,
                  role: action.recipients?.role ?? "",
                  owner: action.recipients?.owner ?? false,
                },
              })
            }
          />
        </Field>
      </>
    </>
  );
}
