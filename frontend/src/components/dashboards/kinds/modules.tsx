/** The module kinds: a page of the product, in miniature. */

import {
  BellOutlined,
  BranchesOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  FolderOpenOutlined,
  FundProjectionScreenOutlined,
  HeartOutlined,
  MailOutlined,
  NotificationOutlined,
  SearchOutlined,
} from "@ant-design/icons";

import type { WidgetKind } from "@/api/dashboards";
import { SEMANTIC, SERIES } from "@/theme/tokens";

import type { KindSpec } from "./spec";

export const MODULE_KINDS = {
  // ── the modules ────────────────────────────────────────────────────────
  // Each is answered by the endpoint its page reads, under its page's
  // permission, and links back to that page. A widget is the page in
  // miniature — never a second implementation of it.
  TASKS: {
    label: "Tasks",
    question: "What is in flight, and which lane is it piled up in?",
    icon: <CheckSquareOutlined />,
    colour: SERIES[0],
    family: "module",
    maximum: 3,
    needs: "nothing",
    page: "/tasks",
  },
  MAIL: {
    label: "Mail",
    question: "What is waiting in the inbox?",
    icon: <MailOutlined />,
    colour: SERIES[1],
    family: "module",
    maximum: 2,
    needs: "nothing",
    page: "/mail",
  },
  FILES: {
    label: "Files",
    question: "What has been uploaded lately?",
    icon: <FolderOpenOutlined />,
    colour: SERIES[7],
    family: "module",
    maximum: 2,
    needs: "nothing",
    page: "/files",
  },
  NOTIFICATIONS: {
    label: "Notifications",
    question: "What has the platform told me?",
    icon: <BellOutlined />,
    colour: SERIES[3],
    family: "module",
    maximum: 1,
    needs: "nothing",
    page: "/notifications",
  },
  PROJECTS: {
    label: "Projects",
    question: "How is delivery going, project by project?",
    icon: <FundProjectionScreenOutlined />,
    colour: SERIES[5],
    family: "module",
    maximum: 2,
    needs: "nothing",
    page: "/projects",
  },
  ANNOUNCEMENTS: {
    label: "Announcements",
    question: "What has been announced to everybody?",
    icon: <NotificationOutlined />,
    colour: SEMANTIC.warning,
    family: "module",
    maximum: 1,
    needs: "nothing",
    page: "/announcements",
  },
  EXPLORER: {
    label: "Data explorer",
    question: "The questions I saved, with today's answer beside each.",
    icon: <SearchOutlined />,
    colour: SERIES[9],
    family: "module",
    maximum: 2,
    needs: "nothing",
    page: "/explore",
  },
  RELATIONSHIPS: {
    label: "Relationships",
    question: "Which records everything else hangs off.",
    icon: <BranchesOutlined />,
    colour: SERIES[6],
    family: "module",
    maximum: 1,
    needs: "nothing",
    page: "/find/relationships",
  },
  FAVORITES: {
    label: "Favourites",
    question: "The places I keep coming back to.",
    icon: <HeartOutlined />,
    colour: SERIES[4],
    family: "module",
    maximum: 1,
    needs: "nothing",
    page: "/favorites",
  },
  CALENDAR: {
    label: "Calendar",
    question: "What is coming up, and who has not answered?",
    icon: <CalendarOutlined />,
    colour: SERIES[2],
    family: "module",
    maximum: 2,
    needs: "nothing",
    page: "/calendar",
  },
} satisfies Partial<Record<WidgetKind, KindSpec>>;
