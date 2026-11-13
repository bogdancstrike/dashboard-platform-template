import { useQuery } from "@tanstack/react-query";
import { Form, Input, Segmented, Select, Switch } from "antd";

import type { WidgetKind } from "@/api/dashboards";
import { kanbanApi } from "@/api/kanban";
import { STALE, queryKeys } from "@/lib/queryKeys";

interface FieldProps {
  datasets: { key: string; label: string }[];
}

function TasksFields() {
  // Only a `TASKS` widget pointed at a board needs the board list, so it is
  // asked for only then — a modal opened on a KPI should cost nothing.
  const boards = useQuery({
    queryKey: queryKeys.kanbanBoards({}),
    queryFn: ({ signal }) => kanbanApi.boards({}, signal),
    staleTime: STALE.long,
  });
  return (
    <>
      <Form.Item
        name="board_id"
        label="A board, or the whole dataset"
        extra="A board shows the lanes that team agreed. Leave empty for every task, by status."
      >
        <Select
          aria-label="Board"
          allowClear
          loading={boards.isLoading}
          options={(boards.data?.items ?? []).map((item) => ({
            value: item.id,
            label: item.name,
          }))}
          notFoundContent={boards.isLoading ? "Loading…" : "No boards yet"}
        />
      </Form.Item>
      <Form.Item name="status" label="One lane only" extra="Leave empty to show them all.">
        <Input placeholder="IN_PROGRESS" />
      </Form.Item>
    </>
  );
}

function MailFields() {
  return (
    <>
      <Form.Item name="folder" label="Folder">
        <Select
          aria-label="Folder"
          options={["INBOX", "SENT", "DRAFTS", "ARCHIVE", "SPAM", "TRASH"].map((item) => ({
            value: item,
            label: item.charAt(0) + item.slice(1).toLowerCase(),
          }))}
        />
      </Form.Item>
      <Form.Item name="unread_only" label="Unread only" valuePropName="checked">
        <Switch />
      </Form.Item>
    </>
  );
}

function NotificationsFields() {
  return (
    <>
      <Form.Item name="category" label="One category only">
        <Input placeholder="Leave empty for all" />
      </Form.Item>
      <Form.Item name="unread_only" label="Unread only" valuePropName="checked">
        <Switch />
      </Form.Item>
    </>
  );
}

function AnnouncementsFields() {
  return (
    <Form.Item name="category" label="One category only">
      <Input placeholder="Leave empty for all" />
    </Form.Item>
  );
}

function ProjectsFields() {
  return (
    <Form.Item name="status" label="One state only" extra="Leave empty to show them all.">
      <Input placeholder="IN_PROGRESS" />
    </Form.Item>
  );
}

function CalendarFields() {
  return (
    <Form.Item
      name="days"
      label="How far ahead"
      extra="An agenda, not a month — a month grid at card size has nothing readable in it."
    >
      <Select
        aria-label="How far ahead"
        options={[
          { value: 1, label: "Today" },
          { value: 3, label: "The next three days" },
          { value: 7, label: "The next week" },
          { value: 14, label: "The next fortnight" },
          { value: 30, label: "The next month" },
        ]}
      />
    </Form.Item>
  );
}

function FavoritesFields() {
  return (
    <Form.Item
      name="view"
      label="Which list"
      extra="A bookmark is a decision you made; a recent is a by-product. They are not the same list."
    >
      <Segmented
        options={[
          { value: "bookmarks", label: "Favourites" },
          { value: "recents", label: "Recently visited" },
        ]}
      />
    </Form.Item>
  );
}

function DatasetScopeFields({ datasets }: FieldProps) {
  return (
    <Form.Item
      name="entity"
      label="One dataset only"
      extra="Leave empty to cover every dataset you can read."
    >
      <Select
        aria-label="Dataset"
        allowClear
        options={datasets.map((item) => ({ value: item.key, label: item.label }))}
      />
    </Form.Item>
  );
}

/**
 * The module options, per kind. Each one narrows the page the widget mirrors;
 * none of them is required, because a module widget with nothing said shows
 * that module's own default view. A kind with no entry asks nothing more.
 */
export const MODULE_FIELDS: Partial<Record<WidgetKind, (props: FieldProps) => JSX.Element>> = {
  TASKS: TasksFields,
  MAIL: MailFields,
  NOTIFICATIONS: NotificationsFields,
  ANNOUNCEMENTS: AnnouncementsFields,
  PROJECTS: ProjectsFields,
  CALENDAR: CalendarFields,
  FAVORITES: FavoritesFields,
  EXPLORER: DatasetScopeFields,
  RELATIONSHIPS: DatasetScopeFields,
};
