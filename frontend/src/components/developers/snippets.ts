/**
 * Request snippets for the API reference and SDK page (§31) — curl, JavaScript,
 * Python — generated from an endpoint rather than written per page, so every
 * route gets them and none can drift from its path.
 */

import type { ApiEndpoint } from "@/api/developers";

export type Language = "curl" | "javascript" | "python";

export interface SnippetInput {
  method: string;
  /** Path with the prefix and parameters filled in. */
  path: string;
  origin: string;
  body?: unknown;
  auth: "bearer" | "key";
}

/** `/platform/api/tasks/<uuid:task_id>` with `{task_id: "x"}` → `/platform/api/tasks/x`. */
export function fillPath(path: string, values: Record<string, string>): string {
  return path.replace(/<(?:[a-z]+:)?([a-z_]+)>/g, (_whole, name: string) =>
    values[name] ? encodeURIComponent(values[name]) : `{${name}}`,
  );
}

/** A plausible placeholder body for a write, from a captured example if there is one. */
export function sampleBody(endpoint: Pick<ApiEndpoint, "body" | "example">): unknown {
  if (!endpoint.body) return undefined;
  if (endpoint.example?.request_body !== undefined && endpoint.example.request_body !== null) {
    return endpoint.example.request_body;
  }
  return {};
}

function authHeader(auth: SnippetInput["auth"]): [string, string] {
  return auth === "key" ? ["X-Api-Key", "$NUCLEUS_API_KEY"] : ["Authorization", "Bearer $NUCLEUS_TOKEN"];
}

export function snippet(language: Language, input: SnippetInput): string {
  const url = `${input.origin}${input.path}`;
  const [header, value] = authHeader(input.auth);
  const json = input.body === undefined ? null : JSON.stringify(input.body, null, 2);
  if (language === "curl") {
    const lines = [`curl -X ${input.method} "${url}"`, `  -H "${header}: ${value}"`];
    if (json !== null) lines.push(`  -H "Content-Type: application/json"`, `  -d '${json.replace(/'/g, "'\\''")}'`);
    return lines.join(" \\\n");
  }
  if (language === "javascript") {
    const envName = input.auth === "key" ? "NUCLEUS_API_KEY" : "NUCLEUS_TOKEN";
    const headerValue = input.auth === "key" ? `process.env.${envName}` : `\`Bearer \${process.env.${envName}}\``;
    return [
      `const response = await fetch("${url}", {`,
      `  method: "${input.method}",`,
      `  headers: {`,
      `    "${header}": ${headerValue},`,
      ...(json !== null ? [`    "Content-Type": "application/json",`] : []),
      `  },`,
      ...(json !== null ? [`  body: JSON.stringify(${json.replace(/\n/g, "\n  ")}),`] : []),
      `});`,
      `if (!response.ok) throw new Error(\`\${response.status}: \${(await response.json()).message}\`);`,
      `const data = await response.json();`,
    ].join("\n");
  }
  const envName = input.auth === "key" ? "NUCLEUS_API_KEY" : "NUCLEUS_TOKEN";
  const headerValue = input.auth === "key" ? `os.environ["${envName}"]` : `f"Bearer {os.environ['${envName}']}"`;
  return [
    "import os",
    "import requests",
    "",
    `response = requests.request(`,
    `    "${input.method}",`,
    `    "${url}",`,
    `    headers={"${header}": ${headerValue}},`,
    ...(json !== null ? [`    json=${pythonLiteral(input.body)},`] : []),
    `    timeout=30,`,
    `)`,
    `response.raise_for_status()`,
    `data = response.json()`,
  ].join("\n");
}

/** JSON as a Python literal: true/false/null become True/False/None. */
export function pythonLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\btrue\b/g, "True")
    .replace(/\bfalse\b/g, "False")
    .replace(/\bnull\b/g, "None");
}

/** The SDK page's minimal clients, one per language. */
export const SDK_CLIENTS: Record<"javascript" | "python", string> = {
  javascript: `// nucleus.js — a minimal client. Node 18+ or any browser.
export function nucleus({ baseUrl, apiKey }) {
  async function call(method, path, body) {
    const response = await fetch(\`\${baseUrl}/platform\${path}\`, {
      method,
      headers: { "X-Api-Key": apiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw Object.assign(new Error(data?.message ?? response.statusText), { status: response.status, data });
    return data;
  }
  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body),
    put: (path, body) => call("PUT", path, body),
    delete: (path) => call("DELETE", path),
  };
}

// const api = nucleus({ baseUrl: "https://nucleus.example.com", apiKey: process.env.NUCLEUS_API_KEY });
// const catalog = await api.get("/api/explorer/catalog");`,
  python: `# nucleus.py — a minimal client. pip install requests
import requests


class Nucleus:
    def __init__(self, base_url: str, api_key: str, timeout: float = 30):
        self.base = base_url.rstrip("/") + "/platform"
        self.session = requests.Session()
        self.session.headers["X-Api-Key"] = api_key
        self.timeout = timeout

    def call(self, method: str, path: str, body=None):
        response = self.session.request(method, self.base + path, json=body, timeout=self.timeout)
        if not response.ok:
            raise RuntimeError(f"{response.status_code}: {response.json().get('message')}")
        return None if response.status_code == 204 else response.json()

    def get(self, path):
        return self.call("GET", path)

    def post(self, path, body=None):
        return self.call("POST", path, body)


# api = Nucleus("https://nucleus.example.com", os.environ["NUCLEUS_API_KEY"])
# catalog = api.get("/api/explorer/catalog")`,
};

/** Endpoints matching a search, by path, summary, group or permission. */
export function matches(endpoint: ApiEndpoint, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${endpoint.method} ${endpoint.path} ${endpoint.summary} ${endpoint.operation} ${endpoint.permissions.join(" ")}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export const METHOD_TONE: Record<string, string> = {
  GET: "acc", POST: "ok", PUT: "warn", PATCH: "warn", DELETE: "bad",
};
