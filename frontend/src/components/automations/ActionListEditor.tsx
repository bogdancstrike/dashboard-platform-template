/**
 * What a rule does when it fires (§49, §76).
 *
 * The editor is rendered from the *server's* action catalogue rather than from
 * a list of kinds typed in here. That is not ceremony: the same declaration
 * says which fields an action needs and which function executes it, so a
 * control this form offers is a control something reads, and an action the
 * engine gained yesterday appears here today. A hand-written form is how you
 * end up asking for a field nothing uses, or — worse — not asking for one the
 * executor requires and finding out when the rule fires at three in the
 * morning.
 *
 * Shared between the create wizard and the edit drawer, because "what it does"
 * is the same question in both and two copies would answer it differently.
 */

import { Alert, Button, Card, Input, Select, Space, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";

import type { AutomationAction, AutomationCatalogue } from "@/api/automations";
import { PeoplePicker } from "@/components/PeoplePicker";

const { Text } = Typography;

/** Placeholders an action's wording may use, stated where somebody types it. */
const PLACEHOLDERS = "{record} · {rule} · {link}";

/**
 * Whether an action can actually run, and why not when it cannot.
 *
 * Pure, and exported so the tests can state the rule directly rather than
 * through a form: an action that reaches nobody is the one mistake this editor
 * exists to prevent, and it is worth asserting without a browser.
 */
export function actionProblem(
  action: AutomationAction,
  needs: string[],
): string | null {
  if (needs.includes("recipients")) {
    const to = action.recipients;
    if (!to || (to.user_ids.length === 0 && !to.role && !to.owner)) {
      return "Say who this reaches.";
    }
  }
  if (needs.includes("url") && !/^https?:\/\/.+/.test(action.url ?? "")) {
    return "A webhook needs a full http:// or https:// address.";
  }
  return null;
}

/** An empty action of one kind, with the recipient shape already in place. */
export function blankAction(kind: string): AutomationAction {
  return {
    kind: kind as AutomationAction["kind"],
    recipients: { user_ids: [], role: "", owner: true },
  };
}

export function ActionListEditor({
  value,
  onChange,
  catalogue,
  disabled,
}: {
  value: AutomationAction[];
  onChange: (next: AutomationAction[]) => void;
  catalogue: AutomationCatalogue;
  disabled?: boolean;
}) {
  const declared = new Map(catalogue.actions.map((item) => [item.kind, item]));

  const replace = (index: number, changes: Partial<AutomationAction>) =>
    onChange(value.map((item, at) => (at === index ? { ...item, ...changes } : item)));

  return (
    <Space direction="vertical" size={12} className="nu-block" data-testid="action-list">
      {value.length === 0 && (
        // Not a neutral empty state: a rule with no actions matches, records
        // fires and does nothing, which is the failure that looks like success.
        <Alert
          type="warning"
          showIcon
          message="This automation would do nothing"
          description="It needs at least one action before it can be saved."
        />
      )}

      {value.map((action, index) => {
        const spec = declared.get(action.kind);
        const needs = spec?.needs ?? [];
        const problem = actionProblem(action, needs);
        return (
          <Card
            key={`${action.kind}-${index}`}
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
                  onChange={(kind: string) =>
                    onChange(
                      value.map((item, at) => (at === index ? blankAction(kind) : item)),
                    )
                  }
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
                onClick={() => onChange(value.filter((_item, at) => at !== index))}
              />
            }
          >
            <div className="nu-action-grid">
              {needs.includes("recipients") && (
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
              )}

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
                    options={["LOW", "NORMAL", "HIGH", "CRITICAL"].map((item) => ({
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
      })}

      <Space size={8} wrap>
        {catalogue.actions.map((item) => (
          <Button
            key={item.kind}
            size="small"
            icon={<PlusOutlined />}
            disabled={disabled || value.length >= 8}
            data-testid={`add-action-${item.kind}`}
            onClick={() => onChange([...value, blankAction(item.kind)])}
          >
            {item.label}
          </Button>
        ))}
      </Space>
    </Space>
  );
}

function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "nu-action-field nu-action-field--wide" : "nu-action-field"}>
      <Text strong className="nu-field-label">
        {label}
      </Text>
      {children}
    </div>
  );
}
