import { Card, Space, Tooltip, Typography } from "antd";
import { ApiOutlined, ThunderboltOutlined, WifiOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";

import { StatusTag } from "@/components/StatusTag";
import { RecordActions, type RecordEditing } from "@/components/records/useRecordEditing";
import { absoluteTime, parseInstant, relativeTime } from "@/lib/time";
import { knownStatusColor, SEMANTIC } from "@/theme/tokens";

import type { DeviceRow } from "./types";

const { Text } = Typography;

const DAY = 86_400_000;

/** How stale a reading is, as the three words an operator would use. */
function freshness(lastSeen: string | null | undefined): {
  label: string;
  colour: string;
} {
  const moment = parseInstant(lastSeen);
  if (!moment) return { label: "never reported", colour: SEMANTIC.danger };
  const age = Date.now() - moment.valueOf();
  if (age < DAY) return { label: "reporting", colour: SEMANTIC.success };
  if (age < 7 * DAY) return { label: "quiet", colour: SEMANTIC.warning };
  return { label: "silent", colour: SEMANTIC.danger };
}

/** A bar rather than a number: forty of these are scanned, not read. */
function Gauge({
  label,
  value,
  icon,
  suffix = "%",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  suffix?: string;
}) {
  const colour =
    value >= 60 ? SEMANTIC.success : value >= 25 ? SEMANTIC.warning : SEMANTIC.danger;
  return (
    <Tooltip title={`${label}: ${Math.round(value)}${suffix}`}>
      <div className="nu-gauge">
        <span className="nu-gauge-icon" style={{ color: colour }} aria-hidden>
          {icon}
        </span>
        <span className="nu-gauge-track">
          <span
            className="nu-gauge-fill"
            style={{ width: `${Math.max(0, Math.min(value, 100))}%`, background: colour }}
          />
        </span>
        <span className="nu-gauge-value">{Math.round(value)}</span>
      </div>
    </Tooltip>
  );
}

/** One unit on the wall: its state, two health bars, and when it last spoke. */
export function DeviceCard({ device, records }: { device: DeviceRow; records: RecordEditing }) {
  const navigate = useNavigate();
  const seen = freshness(device.last_seen_at);
  return (
    <Card
      size="small"
      hoverable
      className="nu-device"
      onClick={() => navigate(`/devices/${device.id}`)}
      style={{
        borderLeft: `3px solid ${knownStatusColor(device.status ?? "") ?? "var(--nu-border)"}`,
      }}
    >
      <div className="nu-device-head">
        <Text strong ellipsis>
          {/* A real link, so the card is reachable by keyboard and opens in a
              new tab; it stops the click so the card's own handler
              does not push the same page a second time. */}
          <Link
            to={`/devices/${device.id}`}
            className="nu-card-link"
            onClick={(event) => event.stopPropagation()}
          >
            {device.name}
          </Link>
        </Text>
        <StatusTag status={device.status} bordered={false} />
        <RecordActions
          records={records}
          id={device.id}
          label={device.serial ?? device.name ?? "this device"}
        />
      </div>

      <Text type="secondary" className="nu-mono nu-device-serial">
        {device.serial}
      </Text>

      <Gauge
        label="Battery"
        value={Number(device.battery_percent ?? 0)}
        icon={<ThunderboltOutlined />}
      />
      <Gauge
        label="Signal"
        value={Number(device.signal_strength ?? 0)}
        icon={<WifiOutlined />}
      />

      <div className="nu-device-foot">
        <Tooltip title={absoluteTime(device.last_seen_at)}>
          <span className="nu-device-seen" style={{ color: seen.colour }}>
            ● {seen.label} · {relativeTime(device.last_seen_at)}
          </span>
        </Tooltip>
        <Space size={8}>
          <Text type="secondary">{device.location}</Text>
          {Number(device.error_count ?? 0) > 0 && (
            <Tooltip title={`${device.error_count} errors logged`}>
              <Text type="danger">
                <ApiOutlined /> {device.error_count}
              </Text>
            </Tooltip>
          )}
        </Space>
      </div>
    </Card>
  );
}
