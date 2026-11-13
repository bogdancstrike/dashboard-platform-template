import { Space, Tag, Typography } from "antd";

import type { CalendarEvent, EventResponse } from "@/api/calendar";
import { ResponseButtons } from "@/components/calendar/ResponseButtons";
import { PersonAvatar } from "@/components/PersonAvatar";

const { Text } = Typography;

const RESPONSE_LABEL: Record<EventResponse, string> = {
  NEEDS_ACTION: "no answer",
  ACCEPTED: "going",
  TENTATIVE: "maybe",
  DECLINED: "not going",
};

/** Who was invited and what each answered — in words, never only a colour. */
export function Attendees({ detail }: { detail: CalendarEvent }) {
  return (
    <div>
      <Text strong className="nu-field-label">
        Who is coming{" "}
        <Text type="secondary">
          {detail.participants.filter((item) => item.response === "ACCEPTED").length} of{" "}
          {detail.participants.length}
        </Text>
      </Text>
      <Space direction="vertical" size={4} className="nu-block">
        {detail.participants.length === 0 && (
          <Text type="secondary">Nobody was invited.</Text>
        )}
        {detail.participants.map((person) => (
          <div key={person.user_id} className="nu-attendee">
            <Space size={8}>
              <PersonAvatar size="small" initials={person.initials} />
              <Text>{person.name ?? person.email ?? "Somebody"}</Text>
              {detail.organizer.id === person.user_id && (
                <Tag bordered={false}>organiser</Tag>
              )}
            </Space>
            {/* In words, never a colour: "no answer" and "not going" are
                different facts and a grey dot says neither (§64). */}
            <Text type={person.response === "DECLINED" ? "danger" : "secondary"}>
              {RESPONSE_LABEL[person.response]}
            </Text>
          </div>
        ))}
      </Space>
    </div>
  );
}

/** "Are you going?" — the first control, and the one most readers came for. */
export function MyResponse({
  value,
  busy,
  onAnswer,
}: {
  value: EventResponse | null;
  busy: boolean;
  onAnswer: (response: EventResponse) => void;
}) {
  return (
    <div>
      <Text strong className="nu-field-label">
        Are you going?
      </Text>
      <div data-testid="my-response">
        <ResponseButtons
          size="middle"
          label="Your answer"
          value={value}
          onChange={onAnswer}
          disabled={busy}
        />
      </div>
      {value === "NEEDS_ACTION" && (
        <Text type="secondary">You have not answered yet.</Text>
      )}
    </div>
  );
}
