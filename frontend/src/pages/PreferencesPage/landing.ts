/** Where the logo and the index route can be pointed. */
export const LANDING_PAGES: { value: string; label: string; path: string }[] = [
  { value: "home", label: "Home", path: "/home" },
  { value: "dashboard", label: "Dashboard", path: "/dashboard" },
  { value: "analytics", label: "Analytics", path: "/analytics" },
  { value: "tasks", label: "Tasks", path: "/tasks" },
  { value: "inbox", label: "Notifications", path: "/notifications" },
  { value: "projects", label: "Projects", path: "/projects" },
  { value: "explore", label: "Data Explorer", path: "/explore" },
];

/** `landing_page` → the route it means. Shared with the shell. */
export function landingPath(value: string | undefined): string {
  // `/home` is the fallback and not `/dashboard`: somebody who has expressed
  // no preference is somebody arriving for the first time, and what is
  // waiting for them is a better first screen than the organisation's
  // revenue. The dashboard is one click away and is what everybody who wants
  // it chooses.
  return LANDING_PAGES.find((item) => item.value === value)?.path ?? "/home";
}

