import { Button, Popconfirm, Space, Switch, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { SignInSession } from "@/api/security";
import { absoluteTime, relativeTime } from "@/lib/time";

import { STATE_LABELS, sessionSituation, sessionTone } from "./securityCopy";

const { Text } = Typography;

interface Write<T> {
  isPending: boolean;
  mutate: (input: T) => void;
}

/** The device, where from, its state and when it was last seen. */
const SESSION_FACTS: ColumnsType<SignInSession> = [
  {
    title: "Device",
    dataIndex: "device",
    render: (value: string, row) => (
      <div className="nu-sec-device">
        <Space size={6}>
          <Text strong>{value}</Text>
          {row.current ? (
            <Tag color="success" bordered={false}>
              This device
            </Tag>
          ) : null}
        </Space>
        <Text type="secondary" className="nu-sec-agent">
          {row.user_agent ?? "No user agent recorded"}
        </Text>
      </div>
    ),
  },
  {
    title: "Where from",
    dataIndex: "ip_address",
    width: 170,
    onCell: () => ({ style: { minWidth: 150 } }),
    render: (value: string | null, row) => (
      <div className="nu-sec-where">
        <Text className="nu-sec-ip">{value ?? "—"}</Text>
        <Text type="secondary">{row.location ?? "Location unknown"}</Text>
      </div>
    ),
  },
  {
    title: "State",
    dataIndex: "state",
    width: 240,
    render: (_value, row) => (
      <Space size={6} className="nu-sec-state">
        <Tag color={sessionTone(row)} bordered={false}>
          {STATE_LABELS[row.state]}
        </Tag>
        <Text type="secondary">{sessionSituation(row)}</Text>
      </Space>
    ),
  },
  {
    title: "Last seen",
    dataIndex: "last_seen_at",
    width: 110,
    render: (value: string | null) => (
      <Tooltip title={absoluteTime(value)}>
        <span>{relativeTime(value)}</span>
      </Tooltip>
    ),
  },
];

/** Where the reader is signed in: device, address, state, and the two things they can do to it. */
export function sessionColumns(trusted: Write<{ id: string; trusted: boolean }>, revoked: Write<string>): ColumnsType<SignInSession> {
  return [
    ...SESSION_FACTS,
    {
      title: "Recognised",
      dataIndex: "trusted",
      width: 110,
      align: "center",
      render: (value: boolean, row) => (
        <Tooltip
          // Said plainly: a page implying that "trusted" grants something
          // would be claiming a control the platform does not have.
          title="A note to yourself. Nothing on the platform treats a recognised device differently — it is here so the one you do not recognise stands out."
        >
          <Switch
            size="small"
            checked={value}
            disabled={row.state !== "ACTIVE" || trusted.isPending}
            aria-label={`Recognise ${row.device}`}
            data-testid={`trust-${row.id}`}
            onChange={(next) => trusted.mutate({ id: row.id, trusted: next })}
          />
        </Tooltip>
      ),
    },
    {
      title: "",
      width: 130,
      align: "right",
      render: (_value, row) =>
        row.can_revoke ? (
          <Popconfirm
            // A different question for your own session, because pressing
            // "revoke" down a list and landing on your own row is how
            // somebody loses their work.
            title={row.current ? "Sign this device out?" : `Sign ${row.device} out?`}
            description={
              row.current
                ? "You will be signed out here and sent back to the sign-in page."
                : "That device is signed out on its next request, even though its token has not expired."
            }
            okText={row.current ? "Sign me out" : "Sign it out"}
            cancelText="Leave it"
            onConfirm={() => revoked.mutate(row.id)}
          >
            <Button data-testid={`revoke-${row.id}`} danger={row.current}>
              {row.current ? "Sign me out" : "Sign out"}
            </Button>
          </Popconfirm>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ];
}
