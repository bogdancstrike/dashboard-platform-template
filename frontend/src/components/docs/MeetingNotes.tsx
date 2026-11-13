/**
 * Meeting notes on a calendar event (§49): the pages taken in it, and "Take
 * notes", which opens the existing page or files a new one in the Meetings
 * space — pre-filled with who was invited and what the event says it is about.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { App as AntApp, Button, Typography } from "antd";
import { Link, useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { docsApi } from "@/api/docs";
import { CoIcon } from "@/components/collab/icons";
import { relativeTime } from "@/lib/time";
import "@/styles/docs.css";

const { Text } = Typography;

export function MeetingNotes({ eventId }: { eventId: string }) {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const notes = useQuery({
    queryKey: ["meeting-notes", eventId],
    queryFn: ({ signal }) => docsApi.meetingNotes(eventId, signal),
    retry: false,
  });
  const take = useMutation({
    mutationFn: () => docsApi.takeNotes(eventId),
    onSuccess: (page) => navigate(`/docs/${page.id}${page.created ? "?edit=1" : ""}`),
    onError: (error) => message.error(error instanceof ApiError ? error.message : "The notes could not be opened."),
  });
  // No permission to read the wiki is a refused read: nothing is drawn.
  if (notes.isError) return null;
  const items = notes.data?.items ?? [];
  const canEdit = notes.data?.can_edit ?? false;
  return (
    <div className="nx-dc-meeting" data-testid="meeting-notes">
      <Text strong className="nu-field-label">
        Meeting notes
      </Text>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <Link to={`/docs/${item.id}`}>
                <CoIcon name="notes" />
                <span className="nx-dc-meeting-title">{item.title}</span>
                <Text type="secondary">
                  {item.actions > 0 ? `${item.tasks}/${item.actions} actions are tasks · ` : ""}
                  {relativeTime(item.updated_at)}
                </Text>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Text type="secondary">No notes yet.</Text>
      )}
      {canEdit && (
        <Button
          icon={<CoIcon name="notes" size={16} />}
          onClick={() => take.mutate()}
          loading={take.isPending}
          data-testid="take-notes"
        >
          {items.length > 0 ? "Open notes" : "Take notes"}
        </Button>
      )}
    </div>
  );
}
