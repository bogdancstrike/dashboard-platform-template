import { Button, Popconfirm, Space, Tag, Tooltip, Typography } from "antd";
import { PlusOutlined, RetweetOutlined, StopOutlined } from "@ant-design/icons";

import type { ApiClientDetail, Credential } from "@/api/apiClients";

import { credentialStory, stateTone } from "./credentialCopy";

const { Text } = Typography;

interface KeyHandlers {
  grace: number;
  busy: boolean;
  onRotate: (credentialId?: string) => void;
  onRevoke: (credentialId: string) => void;
}

/** A client's keys, each with its state in words and its rotate and revoke. */
export function ClientKeys({ client, grace, busy, onRotate, onRevoke }: KeyHandlers & { client: ApiClientDetail }) {
  return (
    <section data-testid="client-keys">
      <Space size={8} align="center">
        <Text strong>Keys</Text>
        <Button
          icon={<PlusOutlined />}
          disabled={busy}
          onClick={() => onRotate(undefined)}
          data-testid="add-key"
        >
          Add a key
        </Button>
      </Space>

      <ul className="nu-api-keys">
        {client.credentials.map((credential) => (
          <li key={credential.id} data-testid={`key-${credential.prefix}`}>
            <span className="nu-api-key-what">
              <Space size={6}>
                <Text className="nu-mono">{credential.prefix}…</Text>
                {/* Written out as well as coloured (§64). */}
                <Tag color={stateTone(credential.state)} bordered={false}>
                  {credential.state.toLowerCase()}
                </Tag>
                {credential.rotated_from_id && (
                  <Tooltip title="Minted by rotating an earlier key">
                    <Tag bordered={false}>rotated</Tag>
                  </Tooltip>
                )}
              </Space>
              <Text type="secondary" className="nu-api-key-story">
                {credential.label} · {credentialStory(credential)}
              </Text>
            </span>

            {credential.state === "ACTIVE" && (
              <KeyActions credential={credential} grace={grace} busy={busy} onRotate={onRotate} onRevoke={onRevoke} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function KeyActions({ credential, grace, busy, onRotate, onRevoke }: KeyHandlers & { credential: Credential }) {
  return (
    <Space size={2}>
      <Popconfirm
        title={`Rotate ${credential.prefix}…?`}
        description={`A new key is minted now and this one keeps working for ${grace} days, so you can redeploy before it stops.`}
        okText="Rotate"
        onConfirm={() => onRotate(credential.id)}
      >
        <Button
          type="text"
          icon={<RetweetOutlined />}
          disabled={busy}
          aria-label={`Rotate ${credential.prefix}`}
          data-testid={`rotate-${credential.prefix}`}
        />
      </Popconfirm>
      <Popconfirm
        title={`Revoke ${credential.prefix}… now?`}
        description="Anything using it fails immediately. There is no grace period — that is what rotation is for."
        okText="Revoke it"
        okButtonProps={{ danger: true }}
        onConfirm={() => onRevoke(credential.id)}
      >
        <Button
          type="text"
          danger
          icon={<StopOutlined />}
          disabled={busy}
          aria-label={`Revoke ${credential.prefix}`}
          data-testid={`revoke-${credential.prefix}`}
        />
      </Popconfirm>
    </Space>
  );
}
