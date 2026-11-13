import { useEffect, useState } from "react";
import dayjs from "dayjs";

import type { SheetStatus } from "@/api/time";

export type Tab = "week" | "entries" | "team" | "reports";

/** Moves to another tab or week; places are pushed, adjustments replaced. */
export type Go = (next: Record<string, string | null>, replace?: boolean) => void;

export const SHEET_TONE: Record<SheetStatus, string> = {
  DRAFT: "nx-td-pilltag",
  SUBMITTED: "nx-td-pilltag nx-td-pilltag--acc",
  APPROVED: "nx-td-pilltag nx-td-pilltag--ok",
  REJECTED: "nx-td-pilltag nx-td-pilltag--bad",
};
export const SHEET_LABEL: Record<SheetStatus, string> = {
  DRAFT: "Draft", SUBMITTED: "Waiting for approval", APPROVED: "Approved", REJECTED: "Rejected",
};

export function weekLabel(start: string): string {
  const from = dayjs(start);
  const to = from.add(6, "day");
  return from.month() === to.month()
    ? `${from.format("D")} – ${to.format("D MMM YYYY")}`
    : `${from.format("D MMM")} – ${to.format("D MMM YYYY")}`;
}

export function useDevice(): "pc" | "tablet" | "phone" {
  const [device, setDevice] = useState<"pc" | "tablet" | "phone">(() => detect());
  useEffect(() => {
    const onResize = () => setDevice(detect());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return device;
}

function detect(): "pc" | "tablet" | "phone" {
  if (typeof window === "undefined") return "pc";
  if (window.innerWidth < 768) return "phone";
  return window.innerWidth < 1200 ? "tablet" : "pc";
}
