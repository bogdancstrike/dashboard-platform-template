/**
 * The HTTP client every request goes through.
 *
 * Three things it guarantees, so that no caller has to:
 *
 * 1. **A correlation id on every request**, echoed back by the server and
 *    attached to any error. A screenshot of a failure that carries the id is
 *    a failure somebody can find in the logs; one without it is a support
 *    ticket that starts with "when did this happen?".
 * 2. **Domain errors as `ApiError`.** The backend answers every failure with
 *    `{error, message, details?}`. Turning that into one exception type means
 *    a screen can ask "was this a 403, and which permission was missing?"
 *    rather than parsing bodies itself.
 * 3. **Cancellation.** Every call accepts a signal, because a filter that
 *    fires on each keystroke will otherwise render the answer to a question
 *    the user has already stopped asking.
 */

import { API_PREFIX, CORRELATION_HEADER } from "@/config";

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly correlationId: string;

  constructor(status: number, body: ApiErrorBody, correlationId: string) {
    super(body.message || body.error || `Request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error || "error";
    this.details = body.details ?? {};
    this.correlationId = correlationId;
  }

  /** No credential at all — the app should send the caller back to sign in. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Authenticated, but the role does not carry the permission. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** The permissions the caller was missing, when the server named them. */
  get missingPermissions(): string[] {
    const missing = this.details["missing_labels"] ?? this.details["missing"];
    return Array.isArray(missing) ? missing.map(String) : [];
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Serialised into the query string; `undefined` and `""` are dropped. */
  params?: Record<string, unknown>;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/** Supplies the bearer token. Set once, when auth initialises. */
let tokenProvider: () => string | null = () => null;

export function setTokenProvider(provider: () => string | null): void {
  tokenProvider = provider;
}

/** Called whenever a request comes back 401, so the shell can react once. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

function newCorrelationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return Math.random().toString(16).slice(2).padEnd(32, "0");
}

export function buildQuery(params: Record<string, unknown> | undefined): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      // The API reads repeated values as a comma-separated list, which is what
      // `core/query.py` splits on.
      const joined = value.filter((v) => v !== undefined && v !== null && v !== "").join(",");
      if (joined) search.set(key, joined);
    } else {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", params, body, signal, headers = {} } = options;
  const correlationId = newCorrelationId();
  const token = tokenProvider();

  const response = await fetch(`${API_PREFIX}${path}${buildQuery(params)}`, {
    method,
    signal,
    headers: {
      Accept: "application/json",
      [CORRELATION_HEADER]: correlationId,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  // The server echoes the id back; prefer its copy so the value in an error
  // message is provably the one it logged against.
  const echoed = response.headers.get(CORRELATION_HEADER) ?? correlationId;

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text ? safeParse(text) : null;

  if (!response.ok) {
    if (response.status === 401) onUnauthorized?.();
    throw new ApiError(response.status, asErrorBody(parsed, response.status), echoed);
  }

  return parsed as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: "invalid_response", message: text.slice(0, 300) };
  }
}

function asErrorBody(parsed: unknown, status: number): ApiErrorBody {
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    return parsed as ApiErrorBody;
  }
  return { error: "error", message: `Request failed with ${status}` };
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "POST", body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "DELETE" }),
};
