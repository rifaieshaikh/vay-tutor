export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, string>;

  constructor(status: number, body: { error?: { code?: string; message?: string; details?: Record<string, string> } }) {
    super(body.error?.message || "The request failed.");
    this.status = status;
    this.code = body.error?.code || "request.failed";
    this.details = body.error?.details || {};
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Client-Version", "1.0.0");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body as T;
}

export type Session = {
  user: { id: string; name: string; email: string; active: boolean };
  institute: { id: string; name: string; code: string };
  actions: string[];
  deployment_mode: string;
};

export type Health = {
  bootstrapped: boolean;
  database: string;
  api: string;
};
