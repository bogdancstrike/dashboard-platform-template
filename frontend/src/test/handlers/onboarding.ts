/** Onboarding (§38), mocked: an administrator's checklist and sample areas. */

import { http, HttpResponse } from "msw";

import type { Checklist, SampleArea } from "@/api/onboarding";

function fresh(): Checklist {
  return {
    role: "ADMINISTRATOR",
    steps: [
      { key: "profile", title: "Complete your profile", description: "A job title helps.", to: "/profile", action: "Open profile", state: "done", auto: true, automatic: true, completed_at: null },
      { key: "invite", title: "Invite your team", description: "Add people.", to: "/admin/users", action: "Open users", state: "todo", auto: false, automatic: true, completed_at: null },
      { key: "integration", title: "Connect an integration", description: "Mail or storage.", to: "/admin/integrations", action: "Open integrations", state: "skipped", auto: false, automatic: true, completed_at: "2026-11-12T10:00:00Z" },
      { key: "tour", title: "Take a page tour", description: "Help & page tour.", to: "/home", action: "Open Home", state: "todo", auto: false, automatic: false, completed_at: null },
    ],
    progress: { done: 2, total: 4, percent: 50 },
    dismissed: false,
    can_load_samples: true,
  };
}

export const onboardingState: { checklist: Checklist; areas: SampleArea[] } = { checklist: fresh(), areas: [] };

export function resetOnboarding(overrides: Partial<Checklist> = {}) {
  onboardingState.checklist = { ...fresh(), ...overrides };
  onboardingState.areas = [
    { key: "customers", label: "Customers", route: "/customers", loaded: 0 },
    { key: "tasks", label: "Tasks", route: "/tasks", loaded: 12 },
  ];
}
resetOnboarding();

function recount() {
  const steps = onboardingState.checklist.steps;
  const done = steps.filter((s) => s.state !== "todo").length;
  onboardingState.checklist.progress = { done, total: steps.length, percent: Math.round((100 * done) / steps.length) };
}

export const onboardingHandlers = [
  http.get("/platform/api/onboarding", () => HttpResponse.json(onboardingState.checklist)),
  http.post("/platform/api/onboarding/steps/:key", async ({ params, request }) => {
    const { state } = (await request.json()) as { state: "done" | "skipped" | "todo" };
    onboardingState.checklist.steps = onboardingState.checklist.steps.map((step) =>
      step.key === params["key"] ? { ...step, state, completed_at: state === "todo" ? null : "2026-11-13T10:00:00Z" } : step);
    recount();
    return HttpResponse.json(onboardingState.checklist);
  }),
  http.post("/platform/api/onboarding/dismiss", async ({ request }) => {
    const { dismissed } = (await request.json()) as { dismissed: boolean };
    onboardingState.checklist = { ...onboardingState.checklist, dismissed };
    return HttpResponse.json(onboardingState.checklist);
  }),
  http.get("/platform/api/onboarding/samples", () => HttpResponse.json({ areas: onboardingState.areas })),
  http.post("/platform/api/onboarding/samples/:area", ({ params }) => {
    if (params["area"] === "broken") return HttpResponse.json({ error: "validation_error", message: "Already loaded." }, { status: 400 });
    onboardingState.areas = onboardingState.areas.map((a) => (a.key === params["area"] ? { ...a, loaded: 8 } : a));
    return HttpResponse.json({ area: params["area"], created: 8, areas: onboardingState.areas }, { status: 201 });
  }),
  http.delete("/platform/api/onboarding/samples/:area", ({ params }) => {
    onboardingState.areas = onboardingState.areas.map((a) => (a.key === params["area"] ? { ...a, loaded: 0 } : a));
    return HttpResponse.json({ area: params["area"], removed: 12, hidden: 0, areas: onboardingState.areas });
  }),
];
