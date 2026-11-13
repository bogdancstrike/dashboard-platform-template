import { Alert, Button, Card, Segmented, Select, Space, Switch, Typography } from "antd";
import { BellOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { NOTIFICATION_CATEGORIES } from "@/api/notifications";
import { chime } from "@/lib/chime";

import { Setting } from "./Setting";
import type { SectionProps } from "./sectionProps";

const { Text } = Typography;

/** When a notification arrives: whether it pops up, which kinds, for how long, where, and with sound. */
export function NotificationsSection({ preferences, save, onTry }: SectionProps & { onTry: () => void }) {
  const notifications = preferences.notifications;
  return (
    <Card
      size="small"
      title={
        <Space>
          <BellOutlined />
          <span>When a notification arrives</span>
        </Space>
      }
      data-testid="pref-notifications"
      id="pref-notifications"
      extra={
        <Button onClick={() => onTry()} data-testid="try-popup">
          Try it
        </Button>
      }
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {/* Deliberately about the *pop-up* and nothing else. Whether a
            notification is made at all, and whether it is emailed, is a
            per-category delivery setting — and joining the two would
            make "stop interrupting me" also mean "stop telling me". */}
        <Setting
          label="Pop-ups"
          hint="The card in the corner. The bell and the notification centre are unaffected."
        >
          <Segmented
            aria-label="Pop-ups"
            value={notifications.popups}
            onChange={(next) =>
              save({ notifications: { popups: next as typeof notifications.popups } })
            }
            options={[
              { value: "all", label: "Everything" },
              { value: "important", label: "Important only" },
              { value: "none", label: "Off" },
            ]}
          />
        </Setting>

        {notifications.popups !== "none" && (
          <PopupSettings preferences={preferences} save={save} />
        )}

        <Alert
          type="info"
          showIcon={false}
          message={
            <Text type="secondary">
              At most three pop-ups are shown at once; a burst collapses into one card
              pointing at{" "}
              <Link to="/notifications">the notification centre</Link>
              .
            </Text>
          }
        />
      </Space>
    </Card>
  );
}

/** Everything about the pop-up itself — shown only while pop-ups are on. */
function PopupSettings({ preferences, save }: SectionProps) {
  const notifications = preferences.notifications;
  return (
    <>
      <Setting
        label="Which kinds"
        hint="Leave empty for all of them. Chosen kinds interrupt; the rest wait in the centre."
      >
        <Select
          mode="multiple"
          allowClear
          aria-label="Which kinds"
          style={{ minWidth: 240 }}
          placeholder="All kinds"
          value={notifications.popup_categories}
          onChange={(value: string[]) =>
            save({ notifications: { popup_categories: value } })
          }
          options={NOTIFICATION_CATEGORIES.map((category) => ({
            value: category,
            label: category.charAt(0) + category.slice(1).toLowerCase(),
          }))}
        />
      </Setting>

      <Setting
        label="How long it stays"
        hint="A pop-up is a nudge. Anything worth reading twice is in the centre."
      >
        <Segmented
          aria-label="How long it stays"
          value={notifications.popup_seconds}
          onChange={(next) =>
            save({
              notifications: {
                popup_seconds: Number(next) as typeof notifications.popup_seconds,
              },
            })
          }
          options={[2, 4, 8, 15].map((seconds) => ({
            value: seconds,
            label: `${seconds}s`,
          }))}
        />
      </Setting>

      <Setting
        label="Where it appears"
        hint="A corner, or centred. The default is the one furthest from what you are reading."
      >
        <Select
          aria-label="Where it appears"
          style={{ width: 160 }}
          value={notifications.popup_placement}
          onChange={(value: typeof notifications.popup_placement) =>
            save({ notifications: { popup_placement: value } })
          }
          options={[
            { value: "topLeft", label: "Top left" },
            { value: "top", label: "Top centre" },
            { value: "topRight", label: "Top right" },
            { value: "bottomLeft", label: "Bottom left" },
            { value: "bottom", label: "Bottom centre" },
            { value: "bottomRight", label: "Bottom right" },
          ]}
        />
      </Setting>

      <PopupLook preferences={preferences} save={save} />
    </>
  );
}

/** How the pop-up reads, and whether it makes a sound. */
function PopupLook({ preferences, save }: SectionProps) {
  const notifications = preferences.notifications;
  return (
    <>
      <Setting
        label="How much it says"
        hint="Compact is the headline alone — five of those are five readable lines."
      >
        <Segmented
          aria-label="How much it says"
          value={notifications.popup_style}
          onChange={(next) =>
            save({
              notifications: {
                popup_style: next as typeof notifications.popup_style,
              },
            })
          }
          options={[
            { value: "full", label: "Title and detail" },
            { value: "compact", label: "Title only" },
          ]}
        />
      </Setting>

      <Setting
        label="Sound"
        hint="A short tone. Some browsers stay silent until you have clicked the page once."
      >
        <Switch
          aria-label="Sound"
          checked={notifications.sound}
          onChange={(value) => {
            save({ notifications: { sound: value } });
            // Played on the way *on*, so switching it on is also
            // hearing it — and so the browser's first-gesture
            // rule is satisfied by the switch itself.
            if (value) chime();
          }}
        />
      </Setting>

    </>
  );
}
