/**
 * Naming and sharing a saved analysis, in a dialog (§5, §10, §28).
 *
 * Both builders had a "Save it" card of their own, and both put it at the
 * bottom of a column — which is to say below the fold, on the page whose whole
 * purpose is to produce the thing that button saves. On the chart builder it
 * sat under an eight-field question *and* a thirteen-tile gallery; a reader
 * had to scroll past everything they had just decided to record their
 * decision.
 *
 * So saving is a dialog opened from the header, where the primary action of a
 * page belongs. That also matches how the rest of the platform behaves (§10):
 * a wizard where a decision has parts, a drawer for one object's fields, a
 * plain dialog for one question — and "what shall I call this, and who may
 * see it" is one question.
 *
 * The two copies had drifted, as copies do: one offered a description as a
 * single line and the other as a textarea, one had a favourite switch beside
 * the name and the other below the scope, and only one of them said what
 * "Shared" means. Written once, they cannot.
 */

import { App as AntApp, Form, Input, Modal, Segmented, Switch, Typography } from "antd";
import { useEffect } from "react";

import { MemberPicker } from "@/components/PeoplePicker";
import type { ReportScope, SavedReport } from "@/api/reports";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

const { Text } = Typography;

/** What the reader is naming. Everything else is the same for both. */
export interface SaveAnalysisValues {
  name: string;
  description?: string;
  scope: ReportScope;
  member_ids?: string[];
  is_favorite?: boolean;
}

export interface SaveAnalysisDialogProps {
  open: boolean;
  /** "chart" or "report" — the noun this dialog is saving. */
  noun: string;
  /** The stored analysis when one is being edited, so the form opens on it. */
  existing: SavedReport | undefined;
  saving: boolean;
  /**
   * Why saving is refused, when it is.
   *
   * Shown in place rather than as a disabled button with no explanation: a
   * chart whose kind the current question cannot feed would be stored as a
   * picture that cannot be drawn (§76).
   */
  blocked?: string | null;
  onClose: () => void;
  onSave: (values: SaveAnalysisValues) => void;
}

export function SaveAnalysisDialog({
  open,
  noun,
  existing,
  saving,
  blocked,
  onClose,
  onSave,
}: SaveAnalysisDialogProps) {
  const [form] = Form.useForm<SaveAnalysisValues>();
  const { touch, settled, requestClose } = useDiscardGuard({
    close: onClose,
    what: "analysis",
  });
  const { message } = AntApp.useApp();

  /**
   * Re-seed the form each time it opens.
   *
   * `initialValues` is read once per mounted form, and this form outlives a
   * close — so without this, opening it after a save would show the previous
   * name, and opening it on a *different* saved analysis would show the one
   * before that.
   */
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      name: existing?.name ?? "",
      description: existing?.description ?? "",
      scope: existing?.scope ?? "PRIVATE",
      member_ids: existing?.members.map((member) => member.id) ?? [],
      is_favorite: existing?.is_favorite ?? false,
    });
  }, [open, existing, form]);

  return (
    <Modal
      open={open}
      title={existing ? `Save ${existing.name}` : `Save this ${noun}`}
      okText={existing ? "Save changes" : `Create ${noun}`}
      confirmLoading={saving}
      onCancel={requestClose}
      okButtonProps={{
        disabled: Boolean(blocked),
        // The e2e and component suites press this by name; the test id keeps
        // them off a label that changes with the noun and the mode.
        "data-testid": `save-${noun}`,
      }}
      onOk={() => {
        if (blocked) {
          message.warning(blocked);
          return;
        }
        void form.submit();
      }}
      destroyOnClose={false}
    >
      {blocked && (
        <Text type="warning" className="nu-block">
          {blocked}
        </Text>
      )}

      settled();
      <Form
        form={form}
        layout="vertical"
        onValuesChange={touch}
        onFinish={(values) => {
          // The page owns the mutation, so the guard settles when the values
          // leave the dialog: a failed save keeps the dialog open with the
          // values still in it, and asking to discard them then would be
          // asking about work that is still here.
          settled();
          onSave(values);
        }}
        requiredMark={false}
      >
        <Form.Item
          name="name"
          label="Name"
          rules={[{ required: true, message: `Give this ${noun} a name people will recognise` }]}
        >
          <Input autoFocus placeholder="Revenue by channel" aria-label="Name" />
        </Form.Item>

        <Form.Item name="description" label="What it answers">
          <Input.TextArea
            rows={2}
            placeholder="Optional — what this is for, and for whom"
            aria-label="Description"
          />
        </Form.Item>

        <Form.Item name="scope" label="Who can see it">
          <Segmented
            data-testid="analysis-scope"
            options={[
              { value: "PRIVATE", label: "Only me" },
              { value: "SHARED", label: "Named people" },
              { value: "PUBLIC", label: "Everyone signed in" },
            ]}
          />
        </Form.Item>

        {/* Only when it is asked for: a member picker on a private analysis is
            a control whose value is discarded. */}
        <Form.Item
          noStyle
          shouldUpdate={(before: { scope?: ReportScope }, after: { scope?: ReportScope }) =>
            before.scope !== after.scope
          }
        >
          {({ getFieldValue }) =>
            (getFieldValue("scope") as ReportScope) === "SHARED" ? (
              <Form.Item name="member_ids" label="Shared with">
                <MemberPicker placeholder="Search colleagues" />
              </Form.Item>
            ) : null
          }
        </Form.Item>

        <Form.Item name="is_favorite" label="Keep it to hand" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
