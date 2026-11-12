import { App, Button } from "antd";

export default function FeedbackToasts() {
  const { message, notification, modal } = App.useApp();
  return (
    <div className="nx-doc-row">
      <Button onClick={() => message.success("Saved")}>Success message</Button>
      <Button onClick={() => message.error("That could not be saved")}>Error message</Button>
      <Button
        onClick={() =>
          notification.info({
            message: "Export ready",
            description: "Tickets · 1,204 rows. Kept for 7 days.",
            placement: "bottomRight",
          })
        }
      >
        Notification
      </Button>
      <Button
        danger
        onClick={() =>
          modal.confirm({
            title: "Delete this report?",
            content: "Its schedule and its shares go with it.",
            okText: "Delete",
            okButtonProps: { danger: true },
          })
        }
      >
        Confirm…
      </Button>
    </div>
  );
}
