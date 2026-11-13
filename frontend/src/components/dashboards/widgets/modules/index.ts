/**
 * The widgets that are *pages of this product*, drawn small (§45).
 *
 * A dashboard whose widgets are only charts is a reporting page. These are the
 * other half: the work waiting in Tasks, the thread nobody has answered in
 * Mail, what lands in the calendar this week, the file somebody uploaded an
 * hour ago. They are what makes a dashboard the place a person starts their
 * day rather than the place they go to check a number.
 *
 * Three rules hold for every one of them, and they are the same three that
 * hold for the chart widgets in `WidgetBody`.
 *
 * **The module's own endpoint answers it.** Not one of these computes
 * anything. Mail is `/api/mail/threads`, tasks are the explorer query the
 * board itself uses, the calendar is the same window `/calendar` expands. A
 * widget that fetched differently from its page would be a second answer to
 * one question, and the two would drift the first week somebody changed
 * either.
 *
 * **It is the page in miniature, and it says so.** Every one of these carries
 * a link back to the page it mirrors, because the honest purpose of a module
 * widget is to tell you whether it is worth opening the page. A card that
 * shows six of two hundred rows and offers no way through is a card that makes
 * somebody hunt through the navigation for what they were just looking at.
 *
 * **The permission is the page's.** The server does not offer a Mail widget to
 * somebody without `mail.access`, and if a shared dashboard carries one
 * anyway, the body says which permission is missing rather than drawing an
 * empty box (§34, §76).
 */


export { TasksBody } from "./TasksBody";
export { ProjectsBody } from "./ProjectsBody";
export { MailBody } from "./MailBody";
export { FilesBody } from "./FilesBody";
export { NotificationsBody } from "./NotificationsBody";
export { AnnouncementsBody } from "./AnnouncementsBody";
export { ExplorerBody } from "./ExplorerBody";
export { RelationshipsBody } from "./RelationshipsBody";
export { FavoritesBody } from "./FavoritesBody";
export { CalendarBody } from "./CalendarBody";
export type { ModuleBodyProps } from "./shared";
