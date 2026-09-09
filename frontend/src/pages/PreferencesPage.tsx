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

import { Alert, Card, Col, Radio, Row, Segmented, Select, Space, Switch, Tag, Typography } from "antd";
import {
  BgColorsOutlined,
  CheckCircleOutlined,
  ColumnHeightOutlined,
  FieldTimeOutlined,
  HomeOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import type { UserPreferences } from "@/api/me";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
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

export default function PreferencesPage() {
  const navigate = useNavigate();
  const { preferences, save, saving, error } = usePreferences();
  const { appearance, density, setAppearance, setDensity } = useAppearance();

  const formats = preferences.formats;
  const defaults = preferences.defaults;
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

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={12}>
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
        </Col>

        <Col xs={24} xl={12}>
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
        </Col>

        <Col xs={24} xl={12}>
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
        </Col>

        <Col xs={24} xl={12}>
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
        </Col>
      </Row>
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
