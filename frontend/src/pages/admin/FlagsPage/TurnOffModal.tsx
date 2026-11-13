import { Alert, Modal } from "antd";

import { ControlsList } from "./ControlsList";
import { blastRadius } from "./flagReach";
import type { useFlagsPage } from "./useFlagsPage";

/** Turning off a flag that gates something: the blast radius, before it happens. */
export function TurnOffModal({ page }: { page: ReturnType<typeof useFlagsPage> }) {
  const { confirming, setConfirming, write, names } = page;
  return (
    <Modal
      open={confirming !== null}
      title={confirming ? `Turn off ${confirming.name}?` : ""}
      okText="Turn it off"
      okButtonProps={{ danger: true, "data-testid": "confirm-flag-off" }}
      confirmLoading={write.isPending}
      onCancel={() => setConfirming(null)}
      onOk={() => {
        if (!confirming) return;
        write.mutate(
          { key: confirming.key, body: { enabled: false } },
          { onSettled: () => setConfirming(null) },
        );
      }}
      width={620}
    >
      {confirming && (
        <>
          <Alert
            className="nu-block"
            type="warning"
            showIcon
            message={`For everybody, at once: ${blastRadius(confirming.controls).join(", ")}.`}
            description="Open tabs follow within a moment; the API refuses the endpoints below with 404 feature_disabled."
          />
          <ControlsList controls={confirming.controls} names={names} />
        </>
      )}
    </Modal>
  );
}
