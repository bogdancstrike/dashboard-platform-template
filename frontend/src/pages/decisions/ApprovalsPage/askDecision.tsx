import { App, Input } from "antd";

/**
 * Confirm a decision, asking for a comment. A rejection needs a reason, so its
 * button waits for one.
 */
export function askDecision(
  modal: ReturnType<typeof App.useApp>["modal"],
  decision: "approve" | "reject",
  run: (comment: string) => void,
  count = 1,
) {
  let comment = "";
  const reject = decision === "reject";
  const many = count > 1 ? `${count} requests` : "this request";
    const dialog = modal.confirm({
      icon: null,
      title: reject ? `Reject ${many}?` : `Approve ${many}?`,
      content: (
        <Input.TextArea
          rows={3}
          autoFocus
          aria-label="Comment"
          placeholder={reject ? "Why — the requester will read this (required)" : "A comment for the requester (optional)"}
          onChange={(event) => {
            comment = event.target.value;
            if (reject) dialog.update({ okButtonProps: { danger: true, disabled: !comment.trim() } });
          }}
        />
      ),
      okText: reject ? "Reject" : "Approve",
      okButtonProps: { danger: reject, disabled: reject },
      onOk: () => run(comment.trim()),
    });
}
