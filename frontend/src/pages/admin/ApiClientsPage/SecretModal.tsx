import { Alert, App as AntApp, Modal, Typography } from "antd";

import type { Credential, Minted } from "@/api/apiClients";
import { absoluteTime } from "@/lib/time";

const { Text, Paragraph } = Typography;


/**
 * The one place a secret is ever shown.
 *
 * A modal rather than a toast, and one that asks before it closes: the value
 * exists nowhere else, and the recovery from losing it is minting another and
 * redeploying whatever held the old one. A notification that scrolled away
 * would take the key with it.
 */
export function SecretModal({
  minted,
  onClose,
  grace,
}: {
  minted: (Minted & { about: string; replaced?: Credential | null }) | null;
  onClose: () => void;
  grace: number;
}) {
  const { modal } = AntApp.useApp();

  return (
    <Modal
      open={minted !== null}
      title="Copy this key now"
      closable={false}
      maskClosable={false}
      keyboard={false}
      okText="I have copied it"
      onOk={() =>
        modal.confirm({
          title: "Closing this is final",
          content:
            "The key is not stored anywhere in a form that can be read back. If you have not copied it, the only fix is to rotate again.",
          okText: "I have it",
          cancelText: "Wait, let me copy it",
          onOk: onClose,
        })
      }
      cancelButtonProps={{ style: { display: "none" } }}
    >
      {minted && (
        // The test id goes on the *content*, not on the `Modal`: AntD forwards
        // unknown props to a wrapper that exists at zero size even when the
        // dialog is open, so `toBeVisible` on it is always false. One id, one
        // meaning, and it is the thing a reader can actually see.
        <div data-testid="secret-modal">
          <Paragraph>
            <Text strong>{minted.about}</Text> can now call the platform with this key. It is
            shown <Text strong>once</Text> — the platform keeps only a hash of it.
          </Paragraph>
          <Paragraph
            copyable={{ text: minted.secret, tooltips: ["Copy the key", "Copied"] }}
            className="nu-api-secret"
            data-testid="secret-value"
          >
            {minted.secret}
          </Paragraph>
          {minted.replaced && (
            <Alert
              type="info"
              showIcon
              message={`The previous key works for ${grace} more days`}
              description={`${minted.replaced.prefix}… expires ${minted.replaced.expires_at ? absoluteTime(minted.replaced.expires_at) : "soon"}. Redeploy whatever uses it before then.`}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
