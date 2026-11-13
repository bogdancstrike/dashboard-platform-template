import { api } from "./client";

/** Onboarding (§38): the checklist per role and sample data per area. See `services/onboarding.py`. */

export interface OnboardingStep {
  key: string;
  title: string;
  description: string;
  /** Where the step is done. */
  to: string;
  action: string;
  state: "todo" | "done" | "skipped";
  /** Ticked off by what the person actually did. */
  auto: boolean;
  /** Whether this step can tick itself off at all. */
  automatic: boolean;
  completed_at: string | null;
}

export interface Checklist {
  role: string;
  steps: OnboardingStep[];
  progress: { done: number; total: number; percent: number };
  dismissed: boolean;
  can_load_samples: boolean;
}

export interface SampleArea {
  key: string;
  label: string;
  route: string;
  loaded: number;
}

export const onboardingApi = {
  checklist: (signal?: AbortSignal) => api.get<Checklist>("/api/onboarding", { signal }),
  answer: (key: string, state: "done" | "skipped" | "todo") =>
    api.post<Checklist>(`/api/onboarding/steps/${key}`, { state }),
  dismiss: (dismissed: boolean) => api.post<Checklist>("/api/onboarding/dismiss", { dismissed }),
  samples: (signal?: AbortSignal) => api.get<{ areas: SampleArea[] }>("/api/onboarding/samples", { signal }),
  load: (area: string) => api.post<{ area: string; created: number; areas: SampleArea[] }>(`/api/onboarding/samples/${area}`, {}),
  remove: (area: string) =>
    api.delete<{ area: string; removed: number; hidden: number; areas: SampleArea[] }>(`/api/onboarding/samples/${area}`),
};
