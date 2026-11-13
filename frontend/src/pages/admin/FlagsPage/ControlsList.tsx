import { Typography } from "antd";

import type { FlagControls } from "@/api/settings";

import { blastRadius } from "./flagReach";

const { Text } = Typography;

/** What a flag controls, as lists — used in the confirmation and the drawer. */
export function ControlsList({ controls, names }: { controls: FlagControls | undefined; names: Record<string, string> }) {
  if (!controls || blastRadius(controls).length === 0 && controls.nav.length === 0 && controls.live.length === 0) {
    return <Text type="secondary">Nothing the catalogue knows of reads this flag — it is an installation&apos;s own.</Text>;
  }
  const section = (title: string, items: string[], mono = false) =>
    items.length > 0 && (
      <div className="nx-ff-controls-section">
        <div className="nx-ff-controls-title">{title}</div>
        <ul>
          {items.map((item) => (
            <li key={item} className={mono ? "nu-mono" : undefined}>
              {item}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="nx-ff-controls" data-testid="flag-controls">
      {section("Pages that show “switched off”", controls.routes, true)}
      {section("Menu entries hidden", controls.nav, true)}
      {section("Components that disappear", controls.components)}
      {section(
        "API endpoints that refuse (404 feature_disabled)",
        controls.endpoints.map((endpoint) => `${endpoint.methods.join(", ")} ${endpoint.url}`),
        true,
      )}
      {section("Background jobs skipped", controls.jobs, true)}
      {section(
        "Live messages not delivered",
        controls.live.map((kind) => (kind === "*" ? "the whole live channel" : kind)),
        true,
      )}
      {section("Payload rules", controls.payload_rules)}
      {section(
        "Flags that go off with it",
        controls.dependents.map((key) => names[key] ?? key),
      )}
    </div>
  );
}
