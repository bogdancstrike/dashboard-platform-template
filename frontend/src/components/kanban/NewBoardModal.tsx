/**
 * Creating a board (§10, §18).
 *
 * A plain modal, not a wizard and not a drawer, because it is *one question*:
 * what is this board for, and who can see it. The platform uses a wizard where
 * a decision has parts (a dashboard's widgets), a drawer for one object's
 * fields (a card), and a modal for one question — and being asked for lanes
 * before the board exists would be the wizard's worst version of itself: the
 * board arrives with five sensible columns and renaming one is a click.
 *
 * The key is *shown* and not asked for. It prefixes every card's reference
 * forever, so a reader should see what they are getting — and being asked to
 * invent a three-letter code before naming the thing is a question about
 * implementation.
 */

import { useMutation } from "@tanstack/react-query";
import { App as AntApp, Form, Input, Modal, Segmented, Typography } from "antd";

import { ApiError } from "@/api/client";
import { kanbanApi, type KanbanBoard } from "@/api/kanban";

const { Text } = Typography;

interface FormValues {
  name: string;
  description?: string;
  scope: string;
}

/**
 * The key a name will produce, mirroring `services/kanban._board_key`.
 *
 * A *preview*, never the value sent: the server owns it, because it also has
 * to make it unique across boards. Shown because it prefixes every card
 * reference on the board from then on, and finding that out afterwards is
 * finding out too late.
 */
export function previewKey(name: string): string {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const letters = words
    .filter((word) => /^[A-Z]/.test(word))
    .map((word) => word[0])
    .join("");
  const raw = letters || name.trim().toUpperCase();
  return raw.replace(/[^A-Z0-9]/g, "").slice(0, 12) || "BOARD";
}

export function NewBoardModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (board: KanbanBoard) => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const { message } = AntApp.useApp();
  // `useWatch` is typed as the field's type, but a field nobody has touched
  // holds nothing — hence the cast rather than a `??` the checker calls dead.
  const name = (Form.useWatch("name", form) as string | undefined) ?? "";

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      kanbanApi.createBoard({
        name: values.name,
        description: values.description,
        scope: values.scope,
      }),
    onSuccess: (board) => {
      message.success(`${board.name} is ready — ${board.lane_count} lanes to start with`);
      form.resetFields();
      onCreated(board);
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "That board could not be created.",
      ),
  });

  return (
    <Modal
      open={open}
      title="New board"
      okText="Create the board"
      confirmLoading={create.isPending}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      onOk={() => void form.submit()}
      okButtonProps={{ "data-testid": "create-board" }}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ scope: "PRIVATE" }}
        onFinish={(values) => create.mutate(values)}
      >
        <Form.Item
          name="name"
          label="What is this board for?"
          rules={[{ required: true, message: "A board needs a name" }]}
          extra={
            name.trim() ? (
              <Text type="secondary">
                Cards on it will be numbered{" "}
                <Text code>{previewKey(name)}-00001</Text> — the platform makes the code
                unique if that one is taken.
              </Text>
            ) : (
              "Its cards take a code from the name, so they can be quoted without it."
            )
          }
        >
          <Input autoFocus placeholder="Platform delivery" aria-label="Board name" />
        </Form.Item>

        <Form.Item name="description" label="Anything worth saying about how it is run">
          <Input.TextArea
            rows={2}
            aria-label="Description"
            placeholder="Reviewed on Tuesdays. Anything in review for more than two days is discussed."
          />
        </Form.Item>

        <Form.Item name="scope" label="Who can see it">
          <Segmented
            data-testid="board-scope"
            options={[
              { value: "PRIVATE", label: "Only me" },
              { value: "SHARED", label: "Named people" },
              { value: "PUBLIC", label: "Everyone signed in" },
            ]}
          />
        </Form.Item>

        <Text type="secondary">
          It arrives with Backlog, Selected, In progress, In review and Done. Rename them,
          reorder them, or add your own — that is the difference between this and the task
          board.
        </Text>
      </Form>
    </Modal>
  );
}
