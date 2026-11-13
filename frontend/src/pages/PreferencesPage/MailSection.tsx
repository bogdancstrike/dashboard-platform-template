import { Card, Input, Segmented, Select, Space, Switch } from "antd";
import { MailOutlined } from "@ant-design/icons";

import { Setting } from "./Setting";
import type { SectionProps } from "./sectionProps";

const MAIL_FOLDERS = ["INBOX", "SENT", "DRAFTS", "ARCHIVE", "SPAM", "TRASH"] as const;

export function MailSection({ preferences, save }: SectionProps) {
  const mail = preferences.mail;
  return (
    <Card
      size="small"
      title={
        <Space>
          <MailOutlined />
          <span>Mail</span>
        </Space>
      }
      data-testid="pref-mail"
      id="pref-mail"
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Setting label="Open in" hint="The folder the mailbox lands on.">
          <Select
            aria-label="Open in"
            style={{ width: 160 }}
            value={mail.default_folder}
            onChange={(value: string) => save({ mail: { default_folder: value } })}
            options={MAIL_FOLDERS.map((folder) => ({
              value: folder,
              label: folder.charAt(0) + folder.slice(1).toLowerCase(),
            }))}
          />
        </Setting>

        <Setting
          label="Reading pane"
          hint="Beside the list, under it, or not at all — then a thread opens on its own."
        >
          <Segmented
            aria-label="Reading pane"
            value={mail.preview}
            onChange={(next) => save({ mail: { preview: next as typeof mail.preview } })}
            options={[
              { value: "right", label: "Right" },
              { value: "bottom", label: "Bottom" },
              { value: "off", label: "Off" },
            ]}
          />
        </Setting>

        <Setting
          label="Mark read when opened"
          hint="Off keeps a thread bold until you say otherwise — some people triage that way."
        >
          <Switch
            aria-label="Mark read when opened"
            checked={mail.mark_read_on_open}
            onChange={(value) => save({ mail: { mark_read_on_open: value } })}
          />
        </Setting>

        <Setting
          label="Signature"
          hint="Added to the bottom of a new message. Yours alone — nobody else sees it on theirs."
        >
          <Input.TextArea
            aria-label="Signature"
            rows={3}
            style={{ minWidth: 260 }}
            defaultValue={mail.signature}
            placeholder="Uma User · Support"
            // On blur rather than on every keystroke: this page saves as
            // you go, and a text field that saves per character is forty
            // writes for one signature.
            onBlur={(event) => {
              if (event.target.value !== mail.signature) {
                save({ mail: { signature: event.target.value } });
              }
            }}
          />
        </Setting>
      </Space>
    </Card>
  );
}
