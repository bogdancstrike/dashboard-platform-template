/**
 * The preference sections, in page order — one registry the side navigation
 * and the page body are both drawn from, so a section cannot be listed in one
 * and missing from the other. Each section draws its own card, with its
 * anchor written out where the tours and tests can find it.
 */
import type { ComponentType } from "react";

import { AppearanceSection } from "./AppearanceSection";
import { DefaultsSection } from "./DefaultsSection";
import { FormatsSection } from "./FormatsSection";
import { MailSection } from "./MailSection";
import { NotificationsSection } from "./NotificationsSection";
import type { SectionProps } from "./sectionProps";

export interface PreferenceSection {
  /** The card's anchor, which the navigation links to. */
  id: string;
  /** What the navigation calls it. */
  nav: string;
  Section: ComponentType<SectionProps & { onTry: () => void }>;
}

export const SECTIONS: PreferenceSection[] = [
  { id: "pref-appearance", nav: "Appearance", Section: AppearanceSection },
  { id: "pref-formats", nav: "Dates, times and numbers", Section: FormatsSection },
  { id: "pref-defaults", nav: "Defaults", Section: DefaultsSection },
  { id: "pref-notifications", nav: "Notifications", Section: NotificationsSection },
  { id: "pref-mail", nav: "Mail", Section: MailSection },
];
