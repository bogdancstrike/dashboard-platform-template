import { App, Button, Input, Modal, Select, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { approvalsApi } from "@/api/approvals";
import { metaApi, type PermissionCatalogue } from "@/api/meta";
import { errorText } from "@/lib/errors";
import { FEATURES, withFeature } from "@/settings/features";

const { Text } = Typography;

/**
 * "Ask for access" on a forbidden page: a request for the permission the page
 * needed, routed to the people who grant permissions, in the approvals inbox.
 *
 * The page may name permissions by code (`audit.view`, from the navigation)
 * or by label ("View audit logs", from an API refusal); both are resolved
 * against the catalogue so the request always carries the code.
 */
function AskForAccessInner({ missing }: { missing: string[] }) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  // Plain state rather than a query: a problem page can render where there is
  // no query client (a boot failure), and must not fail while explaining one.
  const [catalogue, setCatalogue] = useState<PermissionCatalogue | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    metaApi.permissions(controller.signal).then(setCatalogue).catch(() => setCatalogue(null));
    return () => controller.abort();
  }, []);
  const all = (catalogue?.groups ?? []).flatMap((group) => group.permissions);
  const wanted = missing
    .map((item) => all.find((entry) => entry.code === item || entry.label === item))
    .filter((entry): entry is { code: string; label: string } => Boolean(entry));
  const [permission, setPermission] = useState<string | undefined>();
  const chosen = permission ?? wanted[0]?.code;
  const [sent, setSent] = useState<{ reference: string; id: string; already: boolean } | null>(null);

  const [pending, setPending] = useState(false);
  const ask = async () => {
    setPending(true);
    try {
      const row = await approvalsApi.requestAccess({ permission: chosen!, reason, path: window.location.pathname });
      setSent({ reference: row.reference, id: row.id, already: row.already_pending });
      setOpen(false);
      message.success(row.already_pending ? "You already asked — it is still waiting" : "Request sent to the administrators");
    } catch (error) {
      message.error(errorText(error, { action: "ask for access" }));
    } finally {
      setPending(false);
    }
  };

  if (wanted.length === 0) return null;

  if (sent) {
    return (
      <Link to={`/approvals?scope=mine&open=${sent.id}`} data-testid="problem-access-sent">
        <Button>Request {sent.reference} {sent.already ? "is waiting" : "sent"}</Button>
      </Link>
    );
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="problem-ask-access">
        Ask for access
      </Button>
      <Modal
        open={open}
        title="Ask for access"
        okText="Send request"
        onOk={() => void ask()}
        okButtonProps={{ disabled: !chosen }}
        confirmLoading={pending}
        onCancel={() => setOpen(false)}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Text type="secondary">
            An administrator decides it in the approvals inbox. Approved, you are added to a group that grants it, and
            you are told.
          </Text>
          <Select
            aria-label="Permission"
            value={chosen}
            onChange={setPermission}
            style={{ width: "100%" }}
            options={wanted.map((entry) => ({ value: entry.code, label: `${entry.label} (${entry.code})` }))}
          />
          <Input.TextArea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why you need it — the person deciding reads this"
            aria-label="Reason"
          />
        </Space>
      </Modal>
    </>
  );
}

/** Rendered only while approvals are on (§27). */
export const AskForAccess = withFeature(FEATURES.approvals, AskForAccessInner);
