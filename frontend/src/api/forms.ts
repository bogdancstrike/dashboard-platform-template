import { api } from "./client";

/**
 * Intake forms (Time & decisions): the designer's API and the public door.
 * A submission becomes a record through the same writes a person's edit form
 * uses. See `services/forms.py`.
 */

export type FieldType =
  | "text" | "textarea" | "email" | "number" | "select" | "multiselect"
  | "date" | "file" | "rating" | "heading";

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  help?: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  max?: number;
  map_to?: string;
  visible_when?: { field: string; equals: unknown };
}

export interface FormSettings {
  visibility: "PUBLIC" | "INTERNAL";
  confirmation: string;
  notify_user_ids: string[];
  captcha: boolean;
  rate_limit_per_hour: number;
  defaults: Record<string, unknown>;
  submit_label: string;
}

export type FormStatus = "DRAFT" | "PUBLISHED" | "CLOSED";

export interface FormSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  target: string;
  status: FormStatus;
  visibility: "PUBLIC" | "INTERNAL";
  submission_count: number;
  owner: string | null;
  public_path: string;
  updated_at: string | null;
  created_at: string | null;
  field_count: number;
  last_week?: number;
  failed?: number;
}

export interface TargetField {
  name: string;
  label: string;
  kind: string;
  required: boolean;
  choices: string[];
  references: string;
}

export interface FormTarget {
  key: string;
  label: string;
  fields: TargetField[];
}

export interface FormDetail extends FormSummary {
  fields: FormField[];
  settings: FormSettings;
  targets: FormTarget[];
  can_manage: boolean;
}

export interface FormList {
  items: FormSummary[];
  targets: FormTarget[];
  field_types: FieldType[];
  can_manage: boolean;
}

export interface Submission {
  id: string;
  reference: string;
  status: "CONVERTED" | "FAILED" | "SPAM";
  created_at: string | null;
  record_type: string | null;
  record_id: string | null;
  record_label: string | null;
  record_path: string | null;
  error: string;
  submitter_email: string | null;
  answers: { id: string; label: string; value: unknown }[];
}

export interface SubmissionList {
  items: Submission[];
  total: number;
  page: number;
  page_size: number;
  counts: Record<string, number>;
}

export interface PublicForm {
  name: string;
  slug: string;
  description: string;
  status: FormStatus;
  open: boolean;
  fields: FormField[];
  submit_label: string;
  visibility: "PUBLIC" | "INTERNAL";
  challenge: { question: string; token: string } | null;
  honeypot: string;
}

export interface SubmitResult {
  ok: boolean;
  message: string;
  reference: string | null;
  status?: string;
  record_path?: string | null;
  record_label?: string | null;
}

export type FormInput = Partial<Pick<FormDetail, "name" | "slug" | "description" | "target" | "status" | "fields">> & {
  settings?: Partial<FormSettings>;
};

export const formsApi = {
  list: (signal?: AbortSignal) => api.get<FormList>("/api/forms", { signal }),
  get: (id: string, signal?: AbortSignal) => api.get<FormDetail>(`/api/forms/${id}`, { signal }),
  create: (body: FormInput) => api.post<FormDetail>("/api/forms", body),
  update: (id: string, body: FormInput) => api.put<FormDetail>(`/api/forms/${id}`, body),
  remove: (id: string) => api.delete<{ removed: boolean }>(`/api/forms/${id}`),
  submissions: (id: string, params: { status?: string; page?: number }, signal?: AbortSignal) =>
    api.get<SubmissionList>(`/api/forms/${id}/submissions`, { params, signal }),
  retry: (id: string, submissionId: string) =>
    api.post<Submission>(`/api/forms/${id}/submissions/${submissionId}/retry`),
  publicForm: (slug: string, signal?: AbortSignal) => api.get<PublicForm>(`/public/forms/${slug}`, { signal }),
  submit: (slug: string, body: Record<string, unknown>) =>
    api.post<SubmitResult>(`/public/forms/${slug}/submit`, body),
};

/** Whether a field shows, given the answers so far — the server's rule, mirrored. */
export function isVisible(field: FormField, answers: Record<string, unknown>): boolean {
  const rule = field.visible_when;
  if (!rule) return true;
  const value = answers[rule.field];
  if (Array.isArray(value)) return value.includes(rule.equals);
  if (rule.equals === undefined || rule.equals === null || rule.equals === "") return Boolean(value);
  return value === rule.equals;
}
