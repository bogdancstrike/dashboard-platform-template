/** The record kinds: the rows themselves, a few at a time. */

import {
  AlertOutlined,
  FieldTimeOutlined,
  TableOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";

import type { WidgetKind } from "@/api/dashboards";
import { SEMANTIC, SERIES } from "@/theme/tokens";

import type { KindSpec } from "./spec";

export const RECORD_KINDS = {
  LIST: {
    label: "Newest records",
    question: "What arrived most recently?",
    icon: <UnorderedListOutlined />,
    colour: SERIES[2],
    family: "records",
    maximum: 6,
    needs: "dataset",
  },
  TABLE: {
    label: "Table",
    question: "The rows themselves, a few at a time.",
    icon: <TableOutlined />,
    colour: SERIES[8],
    family: "records",
    maximum: 4,
    needs: "dataset",
  },
  ALERTS: {
    label: "Needs attention",
    question: "What is wrong right now?",
    icon: <AlertOutlined />,
    colour: SEMANTIC.danger,
    family: "records",
    maximum: 1,
    needs: "nothing",
  },
  ACTIVITY: {
    label: "Recent activity",
    question: "Who did what, lately?",
    icon: <FieldTimeOutlined />,
    colour: SEMANTIC.info,
    family: "records",
    maximum: 1,
    needs: "nothing",
    page: "/activity",
  },
} satisfies Partial<Record<WidgetKind, KindSpec>>;
