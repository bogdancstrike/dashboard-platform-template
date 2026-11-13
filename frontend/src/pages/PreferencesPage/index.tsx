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

import { Alert, Card, Space, Tag, Typography } from "antd";
import { CheckCircleOutlined, LoadingOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { PageHeader } from "@/components/PageHeader";
import { SettingsNav } from "@/components/layout/SettingsNav";

import { SECTIONS } from "./sections";
import { usePreferencesPage } from "./usePreferencesPage";

export { landingPath } from "./landing";

const { Text, Paragraph } = Typography;

export default function PreferencesPage() {
  const { preferences, save, saving, error, preview } = usePreferencesPage();

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
      <div className="nx-fd-settings">
        <SettingsNav label="Preference sections" sections={SECTIONS.map((section) => [section.id, section.nav])} />
        <div className="nu-prefs nx-fd-setcol">
          {SECTIONS.map(({ id, Section }) => (
            <div key={id}>
              <Section preferences={preferences} save={save} onTry={preview} />
            </div>
          ))}

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
                <Link to="/settings/security">Security</Link>
                .
              </Text>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
