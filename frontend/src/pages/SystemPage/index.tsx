import { Badge, Card, Col, Descriptions, Row } from "antd";

import { PageHeader } from "@/components/PageHeader";
import { statusColor } from "@/theme/tokens";

import { HistoryCard } from "./HistoryCard";
import { WindowPicker } from "./WindowPicker";
import { DependencyTable, ErrorPanel } from "./healthParts";
import { useSystemPage } from "./useSystemPage";

/**
 * §24 — the dependency snapshot, and what each dependency has been doing.
 *
 * The page said only what was true *now*. That is the right answer for a
 * deploy pipeline and the wrong one for a person, who is almost always here
 * because something happened earlier and they want to know whether the
 * platform was part of it.
 */
export default function SystemPage() {
  const page = useSystemPage();
  const { meta, health } = page;

  return (
    <div className="nx-ad nx-ad--health">
      <PageHeader
        title={<>System <em>health</em></>}
        subtitle="Every monitored dependency: what it is doing now, and what it has been doing."
        tag={
          health.data ? (
            <Badge color={statusColor(health.data.status)} text={health.data.status} />
          ) : undefined
        }
        actions={<WindowPicker page={page} />}
      />

      {meta.isError && <ErrorPanel error={meta.error} />}

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={10}>
          <Card size="small" title="Service" loading={meta.isLoading}>
            {meta.data && (
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="Version">{meta.data.version}</Descriptions.Item>
                <Descriptions.Item label="Build">{meta.data.build}</Descriptions.Item>
                <Descriptions.Item label="Environment">{meta.data.environment}</Descriptions.Item>
                <Descriptions.Item label="Realm">{meta.data.auth.realm}</Descriptions.Item>
                <Descriptions.Item label="Client">{meta.data.auth.client_id}</Descriptions.Item>
                <Descriptions.Item label="Issuer">{meta.data.auth.issuer}</Descriptions.Item>
                <Descriptions.Item label="Uptime">
                  {health.data ? `${Math.round(health.data.uptime_seconds)}s` : "—"}
                </Descriptions.Item>
              </Descriptions>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card size="small" title="Dependencies right now" loading={health.isLoading}>
            {health.isError ? (
              <ErrorPanel error={health.error} />
            ) : health.data ? (
              <DependencyTable snapshot={health.data} />
            ) : null}
          </Card>
        </Col>

        <Col xs={24}>
          <HistoryCard page={page} />
        </Col>
      </Row>
    </div>
  );
}
