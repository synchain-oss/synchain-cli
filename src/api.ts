// SPDX-License-Identifier: MIT
import { loadConfig, DEFAULT_BASE_URL, type CliConfig } from "./config.js";
import { sanitizeBlock } from "./util/sanitize.js";
import { assertSafeBaseUrl } from "./util/url.js";

/** Typed error thrown by apiFetch on non-2xx responses. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  url: string;
  constructor(status: number, url: string, body: unknown, message?: string) {
    super(message ?? `API ${status} from ${url}`);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  /** If true, the body is sent as-is (Buffer/stream/string). Otherwise JSON-encoded. */
  rawBody?: boolean;
  headers?: Record<string, string>;
  /** Override config base URL (useful in tests / during login). */
  baseUrl?: string;
  /** Override token (e.g. during login before saveConfig). */
  token?: string | null;
  /** Optional AbortSignal. */
  signal?: AbortSignal;
}

/** Default per-request ceiling for metadata calls so a half-open connection or
 *  slow-loris server can't hang an unattended CLI/agent indefinitely (undici's
 *  own default is 300s). Streaming upload/download use their own stall watchdog. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function joinUrl(base: string, p: string): string {
  if (/^https?:\/\//i.test(p)) {
    // An absolute URL bypasses the baseUrl entirely, so re-assert the https/loopback
    // rule on it too — otherwise a caller (or a server-supplied redirect URL) passing
    // an http:// address would leak the bearer over cleartext despite the baseUrl guard.
    assertSafeBaseUrl(p);
    return p;
  }
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = p.startsWith("/") ? p : `/${p}`;
  return `${trimmedBase}${trimmedPath}`;
}

async function readJsonOrText(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  try {
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Fetches a JSON response from the API. Adds an `Authorization: Bearer` header
 * when a token is in config (or passed via opts.token). Throws ApiError on non-2xx.
 */
export async function apiFetch<T = unknown>(
  pathOrUrl: string,
  opts: ApiFetchOptions = {}
): Promise<T> {
  const cfg = await loadConfig();
  const baseUrl = opts.baseUrl ?? cfg?.baseUrl ?? DEFAULT_BASE_URL;
  // Never transmit the bearer key over cleartext http to a remote host.
  assertSafeBaseUrl(baseUrl);
  const token = opts.token === null ? null : (opts.token ?? cfg?.token);
  const url = joinUrl(baseUrl, pathOrUrl);

  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (token && !headers["Authorization"] && !headers["authorization"]) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (opts.rawBody) {
      body = opts.body as BodyInit;
    } else {
      body = JSON.stringify(opts.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  // Bound every metadata request: honor a caller-supplied signal, else a 30s
  // timeout so `files ls` etc. can never hang an unattended agent forever.
  const signal = opts.signal ?? AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS);

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body,
    signal,
  });

  if (!res.ok) {
    const parsed = await readJsonOrText(res);
    throw new ApiError(res.status, url, parsed);
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return (await res.json()) as T;
  }
  if (res.status === 204) return undefined as T;
  return (await res.text()) as unknown as T;
}

/** Returns the active project id from the --project flag or config.activeProject. */
export function resolveActiveProject(
  cfg: CliConfig | null,
  flagProject: string | undefined
): string {
  if (flagProject && flagProject.length > 0) return flagProject;
  const ap = cfg?.activeProject;
  if (ap?.id) return ap.id;
  throw new Error("No project selected. Pass --project <id> or run `synchain project use <id>`.");
}

/** Cap on the error body that reaches the terminal, measured after indenting. */
const MAX_ERROR_BODY = 2000;
/**
 * Cap on how many lines an error body may occupy.
 *
 * 40, not 20: the bodies worth reading in full are exactly the tall ones -- a 422 listing one
 * line per rejected field, or a stack trace. Cutting those at 20 costs an agent parsing stderr
 * the diagnostic it came for, while 40 still bounds how much of the preceding output can be
 * scrolled away. The character cap remains the backstop for wide bodies.
 */
const MAX_ERROR_BODY_LINES = 40;

/**
 * Renders a raw error body for the terminal: ANSI-sanitized, indented, and capped.
 *
 * This is the **most reachable** sanitizing point in the CLI, not the least. Every command
 * funnels its failure path through here, and unlike the success paths it does not require
 * getting past authentication first: `readJsonOrText` falls back to `res.text()` whenever the
 * content-type is not JSON, so a `text/plain` 4xx from a compromised deployment — or from
 * whatever server a user was talked into pointing `--base-url` at — would otherwise land in the
 * terminal verbatim. (The JSON branch was already safe: `JSON.stringify` escapes control
 * characters.)
 *
 * `sanitizeBlock`, not `sanitizeInline`: an error body is legitimately multi-line, and folding
 * its newlines into spaces would mangle a stack trace or a wrapped message. Blocks keep newlines
 * and tabs, drop CR, and strip every escape sequence — exactly what an error body needs.
 *
 * Keeping newlines then makes **line structure** its own question, and it takes two caps, not
 * one, because they defend different things:
 *   - every continuation line is indented to match the first, so a body cannot emit a line that
 *     reads as the CLI's own output. Colour is no defence — under `NO_COLOR` or a non-TTY,
 *     picocolors emits nothing, and a non-TTY is exactly where an agent parses stderr;
 *   - the **character** cap keeps a body from flooding stderr;
 *   - the **line** cap keeps it from scrolling away what came before. Those are not the same
 *     limit: 2000 characters of newlines is still ~666 lines, more than enough to push the
 *     `API error <status> <url>` line — printed *first* — out of the scroll-back, which is the
 *     very outcome the cap exists to prevent.
 *
 * The cut is marked. A truncated JSON body is syntactically broken, and unlabelled it reads as
 * the server having returned malformed data.
 *
 * Order is sanitize → indent → cap. Capping last is safe precisely because sanitizing has
 * already removed every escape, so a cut can never leave a bare ESC behind.
 */
export function formatErrorBody(raw: unknown): string {
  const text = typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "";
  if (!text) return "";
  const indented = sanitizeBlock(text).replace(/\n/g, "\n  ");
  const lines = indented.split("\n");
  const tooLong = indented.length > MAX_ERROR_BODY;
  const tooTall = lines.length > MAX_ERROR_BODY_LINES;
  if (!tooLong && !tooTall) return indented;
  const capped = (tooTall ? lines.slice(0, MAX_ERROR_BODY_LINES).join("\n") : indented).slice(
    0,
    MAX_ERROR_BODY
  );
  return `${capped}\n  … [truncated]`;
}

/**
 * A headline with an error body rendered under it, or the headline alone when there is none.
 *
 * One owner for this composition. It was briefly hand-replicated at the storage-PUT call site in
 * `files.ts`, and a hand-replicated copy of an untested wiring is exactly what drifts: the
 * two-space continuation prefix here is what makes {@link formatErrorBody}'s own indentation line
 * up, so a copy that loses it silently reopens the line-spoofing this all guards against.
 */
export function withErrorBody(headline: string, raw: unknown): string {
  const body = formatErrorBody(raw);
  return body ? `${headline}\n  ${body}` : headline;
}

/**
 * Pretty-prints an ApiError (or any error) for console output.
 *
 * The body goes through {@link formatErrorBody} via {@link withErrorBody}; see there for why
 * that matters. `err.url` needs no sanitizing for the cross-tenant case: every id interpolated
 * into a path goes through `encodeURIComponent`, which turns an ESC into `%1B`. It is not
 * escape-proof in general — `joinUrl` concatenates the raw `--base-url` string, and
 * `assertSafeBaseUrl` parses it without writing the parsed form back — but that content comes
 * from the user's own argv, so it is self-inflicted rather than attacker-supplied.
 */
export function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    return withErrorBody(`API error ${err.status} ${err.url}`, err.body);
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Returns true if the --json flag is set. Centralized so commands share a convention. */
export function wantsJson(opts: { json?: boolean } | undefined): boolean {
  return Boolean(opts?.json);
}
