/**
 * Personal preferences (§40).
 *
 * The page's job is not to hold the settings — the server does that — but to
 * make it obvious that a choice made here *is* the app's behaviour everywhere
 * else. So every control shows the effect beside it: the format section prints
 * a worked example in the chosen shape, the density switch is applied to the
 * page as it is chosen, and the landing page names where the logo will go.
 *
 * Changes save on the spot rather than behind a Save button. These are
 * per-reader, instantly reversible and cost nothing to get wrong, which is the
 * opposite of the permission matrix's staged-then-confirmed edits (§73) — and
 * a Save button on a preferences page is mostly a way to lose a change.
 */

import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Input,
  Radio,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import {
  BellOutlined,
  BgColorsOutlined,
  CheckCircleOutlined,
  ColumnHeightOutlined,
  FieldTimeOutlined,
  HomeOutlined,
  LoadingOutlined,
  MailOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import type { UserPreferences } from "@/api/me";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { NOTIFICATION_CATEGORIES } from "@/api/notifications";
import { chime } from "@/lib/chime";
import { formatSample } from "@/lib/formats";
import { PREFERENCE_DEFAULTS, usePreferences } from "@/settings/PreferencesProvider";
import { useAppearance } from "@/theme/AppearanceProvider";

const { Text, Paragraph } = Typography;

//: The choices, in the order the control offers them. The *labels* are
//: rendered from `formatSample`, so they are worked examples rather than a
//: fourth spelling of the pattern.
const DATE_PATTERNS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"] as const;
const NUMBER_PATTERNS = ["1,234.56", "1 234,56"] as const;

/** Where the logo and the index route can be pointed. */
const LANDING_PAGES: { value: string; label: string; path: string }[] = [
  { value: "home", label: "Home", path: "/home" },
  { value: "dashboard", label: "Dashboard", path: "/dashboard" },
  { value: "analytics", label: "Analytics", path: "/analytics" },
  { value: "tasks", label: "Tasks", path: "/tasks" },
  { value: "inbox", label: "Notifications", path: "/notifications" },
  { value: "projects", label: "Projects", path: "/projects" },
  { value: "explore", label: "Data Explorer", path: "/explore" },
];

/** `landing_page` → the route it means. Shared with the shell. */
export function landingPath(value: string | undefined): string {
  // `/home` is the fallback and not `/dashboard`: somebody who has expressed
  // no preference is somebody arriving for the first time, and what is
  // waiting for them is a better first screen than the organisation's
  // revenue. The dashboard is one click away and is what everybody who wants
  // it chooses.
  return LANDING_PAGES.find((item) => item.value === value)?.path ?? "/home";
}

/** Every folder a mailbox may open on. The server's vocabulary, not a copy. */
const MAIL_FOLDERS = ["INBOX", "SENT", "DRAFTS", "ARCHIVE", "SPAM", "TRASH"] as const;

export default function PreferencesPage() {
  const navigate = useNavigate();
  const { message, notification } = AntApp.useApp();
  const { preferences, save, saving, error } = usePreferences();
  const { appearance, density, setAppearance, setDensity } = useAppearance();

  const formats = preferences.formats;
  const defaults = preferences.defaults;
  const notifications = preferences.notifications;
  const mail = preferences.mail;

  /**
   * Show what a pop-up looks like, here and now.
   *
   * The one control on this page whose effect cannot be shown *beside* it —
   * everything else prints its own worked example — so it is offered as a
   * button instead. A reader turning pop-ups on wants to know what they have
   * agreed to before the first real one arrives at an inconvenient moment.
   */
  const preview = () => {
    if (notifications.popups === "none") {
      message.info("Pop-ups are off. Turn them on to see one.");
      return;
    }
    // The sound too, which the first version of this forgot — a "Try it" that
    // shows the card and stays silent is the one control on the page that
    // does not do what it says.
    if (notifications.sound) chime();
    notification.open({
      message: "This is a pop-up",
      description:
        notifications.popup_style === "compact"
          ? undefined
          : "Real ones name what happened and link to it.",
      placement: notifications.popup_placement,
      duration: notifications.popup_seconds,
    });
  };
  const sample = formatSample(formats);

  /** Send one field of one section, so the rest cannot be clobbered. */
  const setFormat = <K extends keyof UserPreferences["formats"]>(
    key: K,
    value: UserPreferences["formats"][K],
  ) => save({ formats: { [key]: value } });

  usePageCommands("preferences", [
    {
      id: "preferences.reset",
      label: "Reset my preferences to the defaults",
      keywords: "default restore appearance format",
      run: () => {
        setAppearance(PREFERENCE_DEFAULTS.appearance.theme);
        setDensity(PREFERENCE_DEFAULTS.appearance.density);
        save({ formats: PREFERENCE_DEFAULTS.formats, defaults: PREFERENCE_DEFAULTS.defaults });
      },
    },
    {
      id: "preferences.sidebar",
      label: preferences.appearance.sidebar_collapsed
        ? "Keep the navigation expanded"
        : "Keep the navigation collapsed to icons",
      keywords: "sidebar navigation collapse expand rail icons width",
      run: () =>
        save({
          appearance: { sidebar_collapsed: !preferences.appearance.sidebar_collapsed },
        }),
    },
    {
      id: "preferences.security",
      label: "See where I am signed in",
      keywords: "security sessions sign-ins devices revoke",
      run: () => navigate("/settings/security"),
    },
  ]);

  return (
    <>
      <PageHeader
        title="Preferences"
        subtitle="Yours, stored on the server — so they follow you to another browser and another machine."
        tag={
          saving ? (
            <Tag icon={<LoadingOutlined />} color="processing" data-testid="save-state">
              Saving
            </Tag>
          ) : (
            <Tag icon={<CheckCircleOutlined />} color="green" data-testid="save-state">
              Saved
            </Tag>
          )
        }
      />

      {error && (
        <Alert
          className="nu-block"
          type="error"
          showIcon
          message="That preference could not be saved"
          description={
            error instanceof ApiError ? (
              <Space direction="vertical" size={4}>
                <Text type="secondary">{error.message}</Text>
                <Text code copyable={{ text: error.correlationId }}>
                  {error.correlationId}
                </Text>
              </Space>
            ) : (
              error.message
            )
          }
        />
      )}

      {/* Masonry rather than a row of columns. Six cards of different heights
          in a two-column grid leaves a hole under every short one — the row
          is as tall as its tallest member, and the gap is the difference.
          CSS columns pack them, so the page has no empty space in it. */}
      <div className="nu-prefs">
        <div>
          <Card
            size="small"
            title={
              <Space>
                <BgColorsOutlined />
                <span>Appearance</span>
              </Space>
            }
            data-testid="pref-appearance"
          >
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Setting
                label="Theme"
                hint="System follows the operating system, and keeps following it."
              >
                <Segmented
                  aria-label="Theme"
                  value={appearance}
                  onChange={(next) => setAppearance(next as typeof appearance)}
                  options={[
                    { label: "Light", value: "light" },
                    { label: "Dark", value: "dark" },
                    { label: "System", value: "system" },
                  ]}
                />
              </Setting>

              <Setting
                label="Density"
                hint="Applied to every screen at once — a table at one height under a toolbar at another is worse than no setting."
              >
                <Segmented
                  aria-label="Density"
                  value={density}
                  onChange={(next) => setDensity(next as typeof density)}
                  options={[
                    { label: "Compact", value: "compact" },
                    { label: "Default", value: "middle" },
                    { label: "Comfortable", value: "comfortable" },
                  ]}
                />
              </Setting>

              <Setting label="Start with the sidebar collapsed" hint="Useful on a narrow screen.">
                <Switch
                  aria-label="Start with the sidebar collapsed"
                  checked={preferences.appearance.sidebar_collapsed}
                  onChange={(checked) => save({ appearance: { sidebar_collapsed: checked } })}
                />
              </Setting>
            </Space>
          </Card>
        </div>

        <div>
          <Card
            size="small"
            title={
              <Space>
                <FieldTimeOutlined />
                <span>Dates, times and numbers</span>
              </Space>
            }
            data-testid="pref-formats"
          >
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Setting label="Date" hint="Used by every timestamp in the platform.">
                <Radio.Group
                  aria-label="Date format"
                  value={formats.date}
                  onChange={(event) => setFormat("date", event.target.value as typeof formats.date)}
                  // Each label is the *same function* the rest of the app
                  // renders with, so an option cannot promise a shape it does
                  // not produce. The hardcoded labels did: `MM/DD/YYYY` said
                  // "09/06/2026" and rendered an unpadded "9/6/2026"
                  // everywhere else in the product.
                  options={DATE_PATTERNS.map((pattern) => ({
                    label: formatSample({ ...formats, date: pattern }).date,
                    value: pattern,
                  }))}
                  optionType="button"
                />
              </Setting>

              <Setting label="Time">
                <Segmented
                  aria-label="Time format"
                  value={formats.time}
                  onChange={(next) => setFormat("time", next as typeof formats.time)}
                  options={[
                    { label: "24-hour", value: "24h" },
                    { label: "12-hour", value: "12h" },
                  ]}
                />
              </Setting>

              <Setting label="Numbers">
                <Segmented
                  aria-label="Number format"
                  value={formats.number}
                  // Typed by the options now, so the assertion the old
                  // hardcoded list needed is gone.
                  onChange={(next) => setFormat("number", next)}
                  options={NUMBER_PATTERNS.map((pattern) => ({
                    label: formatSample({ ...formats, number: pattern }).number,
                    value: pattern,
                  }))}
                />
              </Setting>

              {/* The effect, beside the control. A preference whose result you
                  have to go and look for is one people set by trial. */}
              <Alert
                type="info"
                showIcon={false}
                data-testid="format-preview"
                message={
                  <Space size={16} wrap>
                    <span>
                      <Text type="secondary">Date </Text>
                      <Text strong>{sample.date}</Text>
                    </span>
                    <span>
                      <Text type="secondary">Time </Text>
                      <Text strong>{sample.time}</Text>
                    </span>
                    <span>
                      <Text type="secondary">Number </Text>
                      <Text strong>{sample.number}</Text>
                    </span>
                  </Space>
                }
              />
            </Space>
          </Card>
        </div>

        <div>
          <Card
            size="small"
            title={
              <Space>
                <ColumnHeightOutlined />
                <span>Defaults</span>
              </Space>
            }
            data-testid="pref-defaults"
          >
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Setting
                label="Rows per page"
                hint="Every list opens at this size until you change it there."
              >
                <Select
                  aria-label="Rows per page"
                  style={{ width: 140 }}
                  value={defaults.page_size}
                  onChange={(value: 10 | 25 | 50 | 100) => save({ defaults: { page_size: value } })}
                  options={[10, 25, 50, 100].map((size) => ({ value: size, label: `${size} rows` }))}
                />
              </Setting>

              <Setting
                label="Home page"
                hint="Where the logo goes, and what opens when you arrive with no address."
              >
                <Space>
                  <Select
                    aria-label="Home page"
                    style={{ width: 200 }}
                    value={defaults.landing_page}
                    onChange={(value: string) => save({ defaults: { landing_page: value } })}
                    options={LANDING_PAGES.map((item) => ({
                      value: item.value,
                      label: item.label,
                    }))}
                  />
                  <Text type="secondary">
                    <HomeOutlined /> {landingPath(defaults.landing_page)}
                  </Text>
                </Space>
              </Setting>
            </Space>
          </Card>
        </div>

        <div>
          <Card
            size="small"
            title={
              <Space>
                <BellOutlined />
                <span>When a notification arrives</span>
              </Space>
            }
            data-testid="pref-notifications"
            extra={
              <Button onClick={() => preview()} data-testid="try-popup">
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
              )}

              <Alert
                type="info"
                showIcon={false}
                message={
                  <Text type="secondary">
                    At most three pop-ups are shown at once; a burst collapses into one card
                    pointing at{" "}
                    <button
                      type="button"
                      className="nu-link-button"
                      onClick={() => navigate("/notifications")}
                    >
                      the notification centre
                    </button>
                    .
                  </Text>
                }
              />
            </Space>
          </Card>
        </div>

        <div>
          <Card
            size="small"
            title={
              <Space>
                <MailOutlined />
                <span>Mail</span>
              </Space>
            }
            data-testid="pref-mail"
          >
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Setting label="Open in" hint="The folder the mailbox lands on.">
                <Select
                  aria-label="Open in"
                  style={{ width: 160 }}
                  value={mail.default_folder}
                  onChange={(value: string) => save({ mail: { default_folder: value } })}
                  options={MAIL_FOLDERS.map((folder) => ({
                    value: folder,
                    label: folder.charAt(0) + folder.slice(1).toLowerCase(),
                  }))}
                />
              </Setting>

              <Setting
                label="Reading pane"
                hint="Beside the list, under it, or not at all — then a thread opens on its own."
              >
                <Segmented
                  aria-label="Reading pane"
                  value={mail.preview}
                  onChange={(next) => save({ mail: { preview: next as typeof mail.preview } })}
                  options={[
                    { value: "right", label: "Right" },
                    { value: "bottom", label: "Bottom" },
                    { value: "off", label: "Off" },
                  ]}
                />
              </Setting>

              <Setting
                label="Mark read when opened"
                hint="Off keeps a thread bold until you say otherwise — some people triage that way."
              >
                <Switch
                  aria-label="Mark read when opened"
                  checked={mail.mark_read_on_open}
                  onChange={(value) => save({ mail: { mark_read_on_open: value } })}
                />
              </Setting>

              <Setting
                label="Signature"
                hint="Added to the bottom of a new message. Yours alone — nobody else sees it on theirs."
              >
                <Input.TextArea
                  aria-label="Signature"
                  rows={3}
                  style={{ minWidth: 260 }}
                  defaultValue={mail.signature}
                  placeholder="Uma User · Support"
                  // On blur rather than on every keystroke: this page saves as
                  // you go, and a text field that saves per character is forty
                  // writes for one signature.
                  onBlur={(event) => {
                    if (event.target.value !== mail.signature) {
                      save({ mail: { signature: event.target.value } });
                    }
                  }}
                />
              </Setting>
            </Space>
          </Card>
        </div>

        <div>
          <Card size="small" title="Where these live">
            <Paragraph type="secondary">
              Preferences are stored against your account, not in this browser. Signing in on
              another machine brings them with you, and an administrator viewing the platform as
              you (§12) sees your settings rather than their own.
            </Paragraph>
            <Paragraph type="secondary">
              Theme and density are also written to this browser so the first paint after a reload
              does not flash the wrong one — the server copy wins as soon as your profile loads.
            </Paragraph>
            <Text type="secondary">
              Security, sessions and sign-in history live on{" "}
              <button
                type="button"
                className="nu-link-button"
                onClick={() => navigate("/settings/security")}
              >
                Security
              </button>
              .
            </Text>
          </Card>
        </div>
      </div>
    </>
  );
}

/** One labelled control with the reason it exists underneath it. */
function Setting({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="nu-setting">
      <div className="nu-setting-text">
        <Text strong>{label}</Text>
        {hint && (
          <Text type="secondary" className="nu-setting-hint">
            {hint}
          </Text>
        )}
      </div>
      <div className="nu-setting-control">{children}</div>
    </div>
  );
}
